import {
  RELEASE_NOTE_LIMITS,
  RELEASE_NOTE_LIST_MAX,
  WHATS_NEW_DEFAULT_DAYS,
  WHATS_NEW_MAX_DAYS,
  WHATS_NEW_NEEDS_YOU_MAX,
  ReleaseNote,
  notFound,
  releaseNoteId,
  type ChangedFile,
  type CodeHost,
  type CodeHostEvent,
  type Project,
  type PullRequestDetails,
  type ReleaseNoteLink,
  type ReleaseNoteLinkKind,
  type ReleaseNoteStore,
  type Ticket,
  type WhatsNew,
  type WhatsNewMilestone,
  type WorkTracker,
} from "@andy/contracts";
import { ticketKeyFor } from "./pull-requests";
import { parseReleaseNote } from "./release-note";

/**
 * Release notes and the What's new read model (AI-159, ADR-0121). A PR merged into the default
 * branch becomes one stored note: its release-note block when it has one, else its title marked
 * "no note". The text is untrusted PR content: stored capped, rendered as text, never handed to an
 * agent as instructions.
 */

const DAY_MS = 86_400_000;

/** Paths that explain a change further, by kind. Index files (`README.md`) are skipped. */
const LINK_PATTERNS: [ReleaseNoteLinkKind, RegExp][] = [
  ["feature", /^docs\/features\/(?!README\.md$)[^/]+\.md$/],
  ["adr", /^docs\/architecture\/adr\/\d{4}-[^/]+\.md$/],
  ["runbook", /^docs\/runbooks\/(?!README\.md$)[^/]+\.md$/],
];

/** `https://host/owner/repo` from a PR's URL (`…/pull/<n>`); null when it isn't one. */
export function repoUrlOf(prUrl: string): string | null {
  return /^(https:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\/\d+$/.exec(prUrl)?.[1] ?? null;
}

/** Feature files, ADRs and runbooks the PR touched, in that order, capped (ADR-0028). */
export function releaseNoteLinks(
  files: readonly Pick<ChangedFile, "path">[],
  repoUrl: string | null,
): ReleaseNoteLink[] {
  if (!repoUrl) return [];
  const links: ReleaseNoteLink[] = [];
  for (const [kind, pattern] of LINK_PATTERNS) {
    for (const { path } of files) {
      if (!pattern.test(path) || path.length > RELEASE_NOTE_LIMITS.path) continue;
      links.push({ kind, path, url: `${repoUrl}/blob/HEAD/${path}` });
    }
  }
  return links.slice(0, RELEASE_NOTE_LIMITS.links);
}

export interface ReleaseNoteInput {
  projectId: string;
  pr: { number: number; url: string; title: string };
  details: PullRequestDetails;
  ticket: Pick<Ticket, "key" | "title" | "risk"> | null;
  files: readonly Pick<ChangedFile, "path">[];
  recordedAt: string;
  /** `backfill` takes "What changed" from the summary's first sentence when there is no block. */
  fallback?: { source: "backfill"; whatChanged: string };
}

/** One note from a merged PR. The block wins; without one, the fallback, else "no note". */
export function buildReleaseNote(input: ReleaseNoteInput): ReleaseNote {
  const { pr, details, ticket } = input;
  const { note } = parseReleaseNote(details.body);
  const cut = (s: string | null, max: number = RELEASE_NOTE_LIMITS.text) =>
    s === null ? null : s.slice(0, max);
  const text = note
    ? { source: input.fallback ? "backfill" : "note", ...note }
    : input.fallback?.whatChanged
      ? {
          source: "backfill",
          whatChanged: input.fallback.whatChanged,
          howItWorks: null,
          needsYou: null,
        }
      : { source: "no_note", whatChanged: null, howItWorks: null, needsYou: null };
  return ReleaseNote.parse({
    id: releaseNoteId(pr.number),
    projectId: input.projectId,
    prNumber: pr.number,
    prUrl: pr.url,
    prTitle: cut(pr.title, RELEASE_NOTE_LIMITS.title),
    ticketKey: ticket?.key ?? null,
    ticketTitle: cut(ticket?.title ?? null, RELEASE_NOTE_LIMITS.title),
    risk: ticket?.risk ?? null,
    mergedAt: details.mergedAt ?? input.recordedAt,
    mergedBy: details.mergedBy,
    source: text.source,
    whatChanged: cut(text.whatChanged),
    howItWorks: cut(text.howItWorks),
    needsYou: cut(text.needsYou),
    links: releaseNoteLinks(input.files, repoUrlOf(pr.url)),
    recordedAt: input.recordedAt,
  });
}

export type ReleaseNoteOutcome =
  | { result: "ignored"; reason: "not_merged" | "fork" }
  | { result: "recorded"; source: ReleaseNote["source"]; ticket: string | null };

/**
 * Stores a note when a PR merges into the default branch (the webhook calls this once per
 * recorded delivery). Reads the PR's description and changed files from the code host, so an
 * edit made before the merge counts. Forks are ignored, like ticket moves.
 */
export class ReleaseNoteRecorder {
  constructor(
    private readonly codeHost: CodeHost,
    private readonly tracker: WorkTracker,
    private readonly notes: ReleaseNoteStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(event: CodeHostEvent, project: Project): Promise<ReleaseNoteOutcome> {
    if (event.kind !== "pull_request") return { result: "ignored", reason: "not_merged" };
    const pr = event.pullRequest;
    const merged = event.action === "closed" && pr.state === "merged" && pr.intoDefaultBranch;
    if (!merged) return { result: "ignored", reason: "not_merged" };
    if (pr.fromFork) return { result: "ignored", reason: "fork" };
    const [details, files] = await Promise.all([
      this.codeHost.getPullRequestDetails(event.repo, pr.number),
      this.codeHost.listChangedFiles(event.repo, pr.number),
    ]);
    const key = ticketKeyFor(project.key, pr);
    const ticket = key ? await this.tracker.getTicketByKey(project.id, key) : null;
    const note = buildReleaseNote({
      projectId: project.id,
      pr,
      // The host no longer knows the PR: still listed, by title, as "no note".
      details: details ?? { body: "", mergedBy: null, mergedAt: event.receivedAt },
      ticket,
      files: files.items,
      recordedAt: this.now().toISOString(),
    });
    await this.notes.put(note);
    return { result: "recorded", source: note.source, ticket: note.ticketKey };
  }
}

// ── What's new ───────────────────────────────────────────────────────────────

export interface WhatsNewWindow {
  from: Date;
  to: Date;
}

/** `until` defaults to now (a later time reads as now); `since` to 14 days before, at most 90. */
export function whatsNewWindow(now: Date, since?: string, until?: string): WhatsNewWindow {
  const to = new Date(Math.min(until ? Date.parse(until) : now.getTime(), now.getTime()));
  const earliest = to.getTime() - WHATS_NEW_MAX_DAYS * DAY_MS;
  const asked = since ? Date.parse(since) : to.getTime() - WHATS_NEW_DEFAULT_DAYS * DAY_MS;
  return { from: new Date(Math.min(Math.max(asked, earliest), to.getTime())), to };
}

const DONE_STAGES = new Set(["done"]);

/** The top-level epic over a ticket (itself when it is one); null when it has none. */
function topEpic(ticket: Ticket, byId: ReadonlyMap<string, Ticket>): Ticket | null {
  let top: Ticket | null = ticket.type === "epic" ? ticket : null;
  let current = ticket;
  // Bounded walk: a parent cycle can't loop forever.
  for (let depth = 0; depth < 10 && current.parentId; depth++) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    if (parent.type === "epic") top = parent;
    current = parent;
  }
  return top;
}

/** Counts per top-level epic of its non-epic tickets, cancelled ones left out. */
export function milestoneStatus(tickets: readonly Ticket[]): WhatsNewMilestone[] {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const counts = new Map<string, WhatsNewMilestone>();
  for (const t of tickets) {
    if (t.type === "epic" || t.stage === "cancelled") continue;
    if (t.archived && !DONE_STAGES.has(t.stage)) continue;
    const epic = topEpic(t, byId);
    if (!epic) continue;
    const row = counts.get(epic.id) ?? {
      key: epic.key,
      title: epic.title,
      done: 0,
      inReview: 0,
      inProgress: 0,
      notStarted: 0,
      needsYou: 0,
    };
    if (t.stage === "done") row.done++;
    else if (t.stage === "ready_for_review") row.inReview++;
    else if (t.stage === "in_progress") row.inProgress++;
    else row.notStarted++;
    if (t.needsAttention && !t.archived && t.stage !== "done") row.needsYou++;
    counts.set(epic.id, row);
  }
  const rank = (key: string) => tickets.find((t) => t.key === key)?.rank ?? "";
  return [...counts.values()].sort((a, b) => rank(a.key).localeCompare(rank(b.key)));
}

/**
 * The What's new page's one read: the project's tickets (status) and the window's notes (one
 * capped query). Notes get their ticket's top-level epic as it is now, then the epic filter.
 */
export class WhatsNewReader {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly notes: ReleaseNoteStore,
  ) {}

  async read(projectId: string, window: WhatsNewWindow, epic?: string): Promise<WhatsNew> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const [tickets, notes] = await Promise.all([
      this.tracker.listTickets(projectId),
      this.notes.listForProject(projectId, {
        since: window.from.toISOString(),
        until: window.to.toISOString(),
        limit: RELEASE_NOTE_LIST_MAX,
      }),
    ]);
    const byId = new Map(tickets.map((t) => [t.id, t]));
    const byKey = new Map(tickets.map((t) => [t.key, t]));
    const waiting = tickets
      .filter((t) => t.needsAttention && !t.archived && !["done", "cancelled"].includes(t.stage))
      .sort((a, b) => a.rank.localeCompare(b.rank));
    const withEpics = notes.map((n) => {
      const ticket = n.ticketKey ? byKey.get(n.ticketKey) : undefined;
      const top = ticket ? topEpic(ticket, byId) : null;
      return { ...n, epicKey: top?.key ?? null, epicTitle: top?.title ?? null };
    });
    return {
      projectKey: project.key,
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      milestones: milestoneStatus(tickets),
      needsYou: {
        count: waiting.length,
        tickets: waiting
          .slice(0, WHATS_NEW_NEEDS_YOU_MAX)
          .map((t) => ({ key: t.key, title: t.title })),
      },
      notes: epic ? withEpics.filter((n) => n.epicKey === epic) : withEpics,
      truncated: notes.length >= RELEASE_NOTE_LIST_MAX,
    };
  }
}

/** Plain text for MCP: status lines, then one line per note. PR text stays data. */
export function renderWhatsNewText(w: WhatsNew): string {
  const lines = [
    `${w.projectKey} what's new · ${w.window.from.slice(0, 10)} to ${w.window.to.slice(0, 10)}`,
  ];
  const open = w.milestones.filter((m) => m.notStarted + m.inProgress + m.inReview > 0);
  const finished = w.milestones.filter((m) => !open.includes(m));
  if (open.length) {
    lines.push("", "Status");
    for (const m of open) {
      const needs = m.needsYou ? ` · ${m.needsYou} need you` : "";
      lines.push(
        `- ${m.key}: ${m.title} · ${m.done} done, ${m.inReview} in review, ${m.inProgress} in progress, ${m.notStarted} not started${needs}`,
      );
    }
  }
  if (finished.length)
    lines.push(`- Done: ${finished.map((m) => `${m.key}: ${m.title}`).join("; ")}`);
  if (w.needsYou.count) {
    lines.push("", `Needs you (${w.needsYou.count})`);
    lines.push(...w.needsYou.tickets.map((t) => `- ${t.key}: ${t.title}`));
  }
  lines.push("", `Merged (${w.notes.length})`);
  for (const n of w.notes) {
    const what = n.whatChanged ?? `${n.prTitle} (no note)`;
    lines.push(
      `- ${n.mergedAt.slice(0, 10)} · ${what} · ${n.ticketKey ?? "no ticket"} · PR #${n.prNumber}`,
    );
  }
  if (w.truncated)
    lines.push("", "The read cap was reached: older changes in the window are missing.");
  return lines.join("\n");
}
