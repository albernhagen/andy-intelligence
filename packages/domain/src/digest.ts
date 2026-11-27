import {
  ACTIVE_RUN_STATUSES,
  DIGEST_DEFAULT_HOURS,
  DIGEST_MAX_HOURS,
  DispatchIdleReason,
  notFound,
  type Digest,
  type DigestException,
  type DigestHandover,
  type DigestInFlight,
  type DigestMerged,
  type DigestReview,
  type DigestTotals,
  type Project,
  type QuotaClear,
  type QuotaReading,
  type QuotaStore,
  type Run,
  type RunStore,
  type Ticket,
  type TicketEvent,
  type WorkTracker,
} from "@andy/contracts";
import { ticketCost } from "./cost";
import { ProjectTickets } from "./ticket-snapshots";
import { isInFlight } from "./dispatch-caps";
import { MilestoneHolds, type MilestoneReader } from "./milestone-holds";
import {
  idleText,
  nextUp,
  type DispatchFacts,
  type DispatchFactsReader,
  type DispatchProject,
} from "./next-up";
import { openPrs } from "./open-prs";
import { quotaStatus } from "./quota";
import { openBlockerKeys, runLabel, syncWaiting, ticketStatusLine } from "./status-line";
import { resolveWorker } from "./worker";
import { epicOf, withEpicOverrides } from "./overrides";
import type { MergeHold, MergeHoldReader } from "./merge-holds";

/**
 * The daily digest (AI-70, ADR-0081): what Andy reads when he comes back. Exceptions first, then
 * what merged and what it cost, then what is in progress, then totals. Computed on read for a
 * window; nothing is stored or scheduled. `buildDigest` is pure; `DigestReader` gathers its data.
 */

export interface DigestWindow {
  from: Date;
  to: Date;
}

export interface DigestData {
  project: Pick<Project, "key" | "paused" | "runsAtOnce" | "lastDispatch" | "defaultWorker">;
  /** Every ticket in the project. */
  tickets: readonly Ticket[];
  /** Open questions per ticket id. */
  openQuestions: ReadonlyMap<string, number>;
  /** The oldest open question's line per ticket id (AI-73); absent: the count alone is shown. */
  questionLines?: ReadonlyMap<string, string>;
  /** Runs queued or running now. */
  activeRuns: readonly Run[];
  /** Runs whose `endedAt` is in the window. */
  endedRuns: readonly Run[];
  /** Runs of the tickets whose history was read, by ticket id. */
  ticketRuns: ReadonlyMap<string, readonly Run[]>;
  /** History (oldest first) of the tickets that changed in the window, by ticket id. */
  ticketEvents: ReadonlyMap<string, readonly TicketEvent[]>;
  quota: readonly QuotaReading[];
  /** Quota readings Andy cleared in the window (AI-74), newest first. */
  quotaClears: readonly QuotaClear[];
  /** Repos whose merges are held while their default branch is red (AI-382); absent: none read. */
  mergeHolds?: readonly MergeHold[];
  /**
   * AI-385: what the handover's next-up dry run reads besides the above; absent: no handover.
   * Only gathered for a window that reaches now.
   */
  handover?: {
    project: DispatchProject;
    /** Why a Ready ticket waits on its milestone, by ticket id. */
    milestoneHolds: ReadonlyMap<string, string>;
    facts: DispatchFacts;
  };
  /** A read cap was reached (`MAX_DIGEST_TICKET_READS` tickets or `MAX_DIGEST_RUNS` runs). */
  truncated: boolean;
  now: Date;
}

/** Ticket histories one digest reads (ADR-0028); the most recently changed first. */
export const MAX_DIGEST_TICKET_READS = 50;
/** Quota clears one digest reads (ADR-0028); one per reading, so a few a day at most. */
export const MAX_DIGEST_QUOTA_CLEARS = 20;
/** Ended runs one digest counts (ADR-0028). */
export const MAX_DIGEST_RUNS = 500;
/** A window ending this close to now shows current state (waiting, blocked, idle, quota). */
const LIVE_SLACK_MS = 5 * 60 * 1000;
const REASON_MAX = 200;

/**
 * The window for `hours` (default 24, clamped to 1–168) ending at `until` (default now, never
 * later). Callers validate the input; the clamp keeps the read bounded whatever they pass.
 */
export function digestWindow(now: Date, hours?: number, until?: string): DigestWindow {
  const h = Math.min(DIGEST_MAX_HOURS, Math.max(1, Math.floor(hours ?? DIGEST_DEFAULT_HOURS)));
  const parsed = until === undefined ? NaN : Date.parse(until);
  const to = new Date(Number.isNaN(parsed) ? now.getTime() : Math.min(parsed, now.getTime()));
  return { from: new Date(to.getTime() - h * 3_600_000), to };
}

/** The digest for one project and window. Pure: same data, same digest. */
export function buildDigest(window: DigestWindow, data: DigestData): Digest {
  const from = window.from.toISOString();
  const to = window.to.toISOString();
  const inWindow = (iso: string | null) => !!iso && iso >= from && iso <= to;
  // Current state can't be read for a past window, so only a window reaching now shows it.
  const live = window.to.getTime() >= data.now.getTime() - LIVE_SLACK_MS;
  const byId = new Map(data.tickets.map((t) => [t.id, t]));

  const prs = pullRequestsInWindow(data, inWindow);
  const exceptions: DigestException[] = [
    ...failedRuns(data, byId),
    ...syncStops(data, byId),
    ...(live ? syncWaits(data, byId) : []),
    ...prs.filter((p) => p.state === "closed").map((p) => prClosed(p)),
    ...outcomes(prs),
    ...reviewBlockers(data, byId, inWindow, live),
    ...(live ? waitingAndBlocked(data) : []),
    ...(live ? dispatchIdle(data) : []),
    ...(live ? mergesHeld(data) : []),
    ...(live ? quotaAtReserve(data) : []),
    ...quotaCleared(data, inWindow),
  ];
  const merged = prs.filter((p) => p.state === "merged").map((p) => mergedItem(p, data));
  // In flight as the dispatcher and the in-flight view count it (ADR-0080): a run past its
  // deadline is waiting for the watchdog, not in flight.
  const inFlight = live
    ? data.activeRuns
        .filter((r) => isInFlight(r, data.now))
        .map((r) => inFlightItem(r, byId, data.now))
    : [];
  const readyForReview = live ? inReview(data) : [];
  const totals = totalsOf(data.endedRuns, merged.length);
  const handover = live && data.handover ? handoverOf(data, data.handover) : null;

  const quiet =
    exceptions.length === 0 &&
    merged.length === 0 &&
    inFlight.length === 0 &&
    readyForReview.length === 0 &&
    totals.runs === 0 &&
    !data.truncated;
  const digest: Omit<Digest, "text"> = {
    projectKey: data.project.key,
    window: { from, to },
    quiet,
    exceptions,
    merged,
    inProgress: { inFlight, readyForReview },
    totals,
    truncated: data.truncated,
    summary: null,
    handover,
  };
  return { ...digest, text: renderDigestText(digest, live) };
}

const label = (t: Pick<Ticket, "key" | "title"> | undefined) =>
  t ? { ticketKey: t.key, title: t.title } : { ticketKey: null, title: null };
const clip = (text: string) => (text.length > REASON_MAX ? `${text.slice(0, REASON_MAX)}…` : text);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const capital = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

function failedRuns(data: DigestData, byId: Map<string, Ticket>): DigestException[] {
  const all = [...data.endedRuns, ...data.activeRuns, ...[...data.ticketRuns.values()].flat()];
  return data.endedRuns
    .filter((r) => r.status === "failed")
    .map((r) => {
      const retried = all.some((x) => x.retryOf === r.id);
      const why = clip(r.error ?? "no reason recorded");
      return {
        kind: "run_failed",
        ...label(r.ticketId ? byId.get(r.ticketId) : undefined),
        prNumber: null,
        reason: `${capital(r.step)} task failed${retried ? ", retried" : ""}: ${why}`,
        at: r.endedAt,
      };
    });
}

/** Sync runs that ended in the window on a conflict or failing checks (AI-72, ADR-0083). */
function syncStops(data: DigestData, byId: Map<string, Ticket>): DigestException[] {
  return data.endedRuns.flatMap((r): DigestException[] => {
    const outcome = r.syncRun?.outcome;
    if (r.step !== "sync" || (outcome !== "conflict_unresolved" && outcome !== "checks_failed")) {
      return [];
    }
    const files = r.syncRun!.conflictFiles;
    const named = files.length > 0 ? `: ${clip(files.join(", "))}` : "";
    const why =
      outcome === "conflict_unresolved" ? "a conflict it couldn't resolve" : "checks failed";
    return [
      {
        kind: "sync_stopped",
        ...label(r.ticketId ? byId.get(r.ticketId) : undefined),
        prNumber: r.syncRun!.number,
        reason: `Sync with main stopped on PR #${r.syncRun!.number} (${why})${named}`,
        at: r.endedAt,
      },
    ];
  });
}

/** Open agent PRs whose wanted sync waits now, with the reason (AI-72); live windows only. */
function syncWaits(data: DigestData, byId: Map<string, Ticket>): DigestException[] {
  return [...data.ticketRuns].flatMap(([ticketId, runs]): DigestException[] => {
    const ticket = byId.get(ticketId);
    if (!ticket || ticket.archived || ticket.stage === "done" || ticket.stage === "cancelled") {
      return [];
    }
    const why = syncWaiting(runs);
    const build = runs.find((r) => r.step === "build" && r.links.pullRequest);
    // A run of the ticket in flight is a moment's wait, not news.
    if (!why || !build?.prSync || build.prSync.waiting === "ticket_busy") return [];
    const number = Number(/\/pull\/(\d+)$/.exec(build.links.pullRequest ?? "")?.[1]) || null;
    return [
      {
        kind: "sync_waiting",
        ...label(ticket),
        prNumber: number,
        reason: `${number ? `PR #${number}: s` : "S"}ync with main waits: ${why}`,
        at: build.prSync.pendingSince,
      },
    ];
  });
}

interface PrInWindow {
  ticket: Ticket;
  number: number;
  url: string;
  state: "open" | "closed" | "merged";
  at: string;
  /** The run that links to this PR; undefined when none does. */
  run: Run | undefined;
}

/**
 * Each PR's last link event inside the window, per ticket read. Keyed by URL, which names the
 * repo and the number, so two repos in one project can't collide.
 */
function pullRequestsInWindow(
  data: DigestData,
  inWindow: (iso: string | null) => boolean,
): PrInWindow[] {
  const found = new Map<string, PrInWindow>();
  for (const ticket of data.tickets) {
    for (const e of data.ticketEvents.get(ticket.id) ?? []) {
      if (e.kind !== "pr_linked" || !inWindow(e.createdAt)) continue;
      const { number, url, state } = e.data;
      if (typeof number !== "number" || typeof url !== "string") continue;
      if (state !== "open" && state !== "closed" && state !== "merged") continue;
      found.set(url, { ticket, number, url, state, at: e.createdAt, run: undefined });
    }
  }
  return [...found.values()]
    .map((p) => ({ ...p, run: runForPr(data.ticketRuns.get(p.ticket.id) ?? [], p.url) }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** The run that links to this PR. No guessing: a PR no run links to has an unknown run. */
function runForPr(runs: readonly Run[], url: string): Run | undefined {
  return runs.find((r) => r.links.pullRequest === url);
}

function prClosed(p: PrInWindow): DigestException {
  return {
    kind: "pr_closed",
    ...label(p.ticket),
    prNumber: p.number,
    reason: `PR #${p.number} closed without merging`,
    at: p.at,
  };
}

function outcomes(prs: PrInWindow[]): DigestException[] {
  return prs.flatMap((p): DigestException[] => {
    const outcome = p.run?.outcome;
    if (outcome !== "reworked" && outcome !== "reverted") return [];
    const reworks = p.run?.metrics?.reworks;
    const reason =
      outcome === "reverted"
        ? `PR #${p.number} was reverted`
        : `PR #${p.number} needed rework${reworks ? ` (${plural(reworks, "time")})` : ""}`;
    return [{ kind: outcome, ...label(p.ticket), prNumber: p.number, reason, at: p.at }];
  });
}

/** PRs a review agent blocked: still open now, or closed or merged in the window. */
function reviewBlockers(
  data: DigestData,
  byId: Map<string, Ticket>,
  inWindow: (iso: string | null) => boolean,
  live: boolean,
): DigestException[] {
  const out: DigestException[] = [];
  for (const [ticketId, events] of data.ticketEvents) {
    const last = events.findLast((e) => e.kind === "pr_linked");
    const { number, url, state } = last?.data ?? {};
    if (!last || typeof number !== "number" || typeof url !== "string") continue;
    if (!(inWindow(last.createdAt) || (live && state === "open"))) continue;
    const run = runForPr(data.ticketRuns.get(ticketId) ?? [], url);
    const failures = run?.metrics?.reviewFailures ?? [];
    if (failures.length === 0) continue;
    const names = [...new Set(failures.map((f) => f.split("@")[0]))].join(", ");
    out.push({
      kind: "review_blocker",
      ...label(byId.get(ticketId)),
      prNumber: number,
      reason: `PR #${number}: blocker from ${clip(names)}`,
      at: null,
    });
  }
  return out;
}

/** Open tickets whose status line waits on Andy, else that are blocked (the story panel's words). */
function waitingAndBlocked(data: DigestData): DigestException[] {
  const out: DigestException[] = [];
  for (const t of data.tickets) {
    if (t.archived || t.stage === "done" || t.stage === "cancelled") continue;
    const line = ticketStatusLine(
      t,
      {
        tickets: data.tickets,
        openQuestions: data.openQuestions.get(t.id) ?? 0,
        runs: data.activeRuns.filter((r) => r.ticketId === t.id),
        events: data.ticketEvents.get(t.id) ?? [],
        // AI-116: the epic's pick counts, as for the dispatcher and the card.
        worker: resolveWorker(withEpicOverrides(t, epicOf(t, data.tickets)), data.project),
        questionLine: data.questionLines?.get(t.id) ?? null,
      },
      data.now,
    );
    const common = { ...label(t), prNumber: null, at: t.updatedAt };
    if (line.tone === "attention") {
      out.push({ kind: "waiting_on_andy", ...common, reason: line.text });
    } else if (openBlockerKeys(t, data.tickets).length > 0) {
      out.push({ kind: "blocked", ...common, reason: line.text });
    }
  }
  return out;
}

function dispatchIdle({ project }: DigestData): DigestException[] {
  const decision = project.paused ? "paused" : project.lastDispatch?.decision;
  const idle = DispatchIdleReason.safeParse(decision);
  if (!idle.success) return [];
  const at = project.lastDispatch?.decision === idle.data ? project.lastDispatch.at : null;
  const reason = idleText(idle.data, project);
  return [{ kind: "dispatch_idle", ticketKey: null, title: null, prNumber: null, reason, at }];
}

/** A red default branch holding the merge queue (AI-382): named by its failing checks. */
function mergesHeld(data: DigestData): DigestException[] {
  return (data.mergeHolds ?? []).map((h) => ({
    kind: "merge_held" as const,
    ticketKey: null,
    title: null,
    prNumber: null,
    reason: clip(
      `Merges into ${h.repo} are held: main is red (failing: ${h.checks.join(", ") || "a required check"}); ${plural(h.waiting, "PR")} waiting`,
    ),
    at: h.since,
  }));
}

const WINDOW_NAMES: Record<string, string> = { "5h": "5-hour", weekly: "Weekly" };

function quotaAtReserve(data: DigestData): DigestException[] {
  const status = quotaStatus("claude-sub", [...data.quota], data.now);
  return status.windows
    .filter((w) => w.level === "pause")
    .map((w) => ({
      kind: "quota_reserve" as const,
      ticketKey: null,
      title: null,
      prNumber: null,
      reason: `${WINDOW_NAMES[w.window] ?? w.window} quota ${w.usedPct}% used: at the reserve (dispatch stops at ${status.pausePct}%)`,
      at: w.takenAt,
    }));
}

/** Andy's clears of a quota idle (AI-74): what he discarded, so a wrong clear can be spotted. */
function quotaCleared(data: DigestData, inWindow: (iso: string) => boolean): DigestException[] {
  return data.quotaClears
    .filter((c) => inWindow(c.at))
    .map((c) => ({
      kind: "quota_cleared" as const,
      ticketKey: null,
      title: null,
      prNumber: null,
      reason: `${WINDOW_NAMES[c.window] ?? c.window} quota reading of ${c.usedPct}% cleared by ${c.by}: dispatch no longer held at the reserve by it`,
      at: c.at,
    }));
}

function mergedItem(p: PrInWindow, data: DigestData): DigestMerged {
  const cost = ticketCost(data.ticketRuns.get(p.ticket.id) ?? []);
  const { run } = p;
  // The control plane records a merge attempt per head; a clean one means the gate merged it.
  const mergedBy = !run ? "unknown" : run.mergeAttemptedSha && !run.mergeError ? "gate" : "andy";
  return {
    ticketKey: p.ticket.key,
    title: p.ticket.title,
    prNumber: p.number,
    prUrl: p.url,
    mergedAt: p.at,
    mergedBy,
    gate: run
      ? { wouldAutoMerge: run.wouldAutoMerge, reasons: run.gateReasons, outcome: run.outcome }
      : null,
    costUsd: cost.estimatedCostUsd,
    unknownCostRuns: cost.unknownRuns,
  };
}

/** Open PRs with why each waits, and what dispatch would take next (AI-385). */
function handoverOf(data: DigestData, input: NonNullable<DigestData["handover"]>): DigestHandover {
  const prs = openPrs({
    tickets: data.tickets,
    ticketEvents: data.ticketEvents,
    ticketRuns: data.ticketRuns,
    mergeHolds: data.mergeHolds ?? [],
  });
  const next = nextUp({
    project: input.project,
    tickets: data.tickets,
    openQuestions: data.openQuestions,
    activeRuns: data.activeRuns,
    ticketRuns: data.ticketRuns,
    milestoneHolds: input.milestoneHolds,
    facts: input.facts,
    now: data.now,
  });
  return {
    openPrs: prs.openPrs,
    openPrsTruncated: prs.truncated,
    nextUp: next.items,
    nextUpTruncated: next.truncated,
    idle: next.idle,
  };
}

function inFlightItem(r: Run, byId: Map<string, Ticket>, now: Date): DigestInFlight {
  return {
    ...label(r.ticketId ? byId.get(r.ticketId) : undefined),
    step: r.step,
    status: r.status,
    label: runLabel(r, now.getTime()),
  };
}

function inReview(data: DigestData): DigestReview[] {
  return data.tickets
    .filter((t) => t.stage === "ready_for_review" && !t.archived)
    .map((t) => ({
      ticketKey: t.key,
      title: t.title,
      prNumber: lastPrNumber(data.ticketEvents.get(t.id) ?? []),
    }));
}

/** The number of the last PR linked in a ticket's history (oldest first); null when none. */
export function lastPrNumber(events: readonly TicketEvent[]): number | null {
  const n = events.findLast((e) => e.kind === "pr_linked")?.data.number;
  return typeof n === "number" ? n : null;
}

function totalsOf(endedRuns: readonly Run[], merged: number): DigestTotals {
  const cost = ticketCost(endedRuns.filter((r) => !ACTIVE_RUN_STATUSES.includes(r.status)));
  return {
    runs: endedRuns.length,
    failedRuns: endedRuns.filter((r) => r.status === "failed").length,
    costUsd: cost.estimatedCostUsd,
    unknownCostRuns: cost.unknownRuns,
    quotaDelta: cost.quotaDelta,
    merged,
  };
}

// ── Plain text ───────────────────────────────────────────────────────────────

const usd = (n: number) => `$${n.toFixed(2)}`;
/** How the text and the page name who merged a PR. */
export const MERGED_BY: Record<DigestMerged["mergedBy"], string> = {
  gate: "auto-merged",
  andy: "merged by Andy",
  unknown: "merger unknown",
};
const day = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

function windowText(d: Pick<Digest, "window">, live: boolean): string {
  const hours = Math.round((Date.parse(d.window.to) - Date.parse(d.window.from)) / 3_600_000);
  return live ? `last ${plural(hours, "hour")}` : `${day(d.window.from)} to ${day(d.window.to)}`;
}

const who = (x: { ticketKey: string | null; title: string | null }) =>
  x.ticketKey ? `${x.ticketKey}: ${x.title}` : "Project";

export function gateText(m: DigestMerged): string {
  if (!m.gate) return "gate unknown";
  const { wouldAutoMerge, reasons, outcome } = m.gate;
  const gate =
    wouldAutoMerge === null
      ? "gate not run"
      : wouldAutoMerge
        ? "gate passed"
        : `gate held${reasons.length ? ` (${reasons.join(", ")})` : ""}`;
  return outcome && outcome !== "merged_clean" ? `${gate}, ${outcome}` : gate;
}

function quotaText(delta: DigestTotals["quotaDelta"]): string | null {
  const parts = [
    delta["5h"] !== null ? `5-hour +${delta["5h"]} pts` : null,
    delta.weekly !== null ? `weekly +${delta.weekly} pts` : null,
  ].filter(Boolean);
  return parts.length ? `quota ${parts.join(", ")}` : null;
}

/** The digest as plain text: one line when quiet. Ticket titles are Andy's text. */
export function renderDigestText(d: Omit<Digest, "text">, live: boolean): string {
  const head = `${d.projectKey} digest · ${windowText(d, live)}`;
  if (d.quiet) {
    const handover = d.handover ? handoverText(d.handover) : [];
    return [`${head}: nothing happened.`, ...handover].join("\n");
  }
  const lines = [head];
  const section = (title: string, items: string[]) => {
    if (items.length) lines.push("", `${title} (${items.length})`, ...items.map((i) => `- ${i}`));
  };
  section(
    "Exceptions",
    d.exceptions.map((e) => `${who(e)} · ${e.reason}`),
  );
  section(
    "Merged",
    d.merged.map((m) => {
      const unknown = m.unknownCostRuns
        ? ` (+${plural(m.unknownCostRuns, "agent task")} unknown)`
        : "";
      const by = MERGED_BY[m.mergedBy];
      return `${who(m)} · PR #${m.prNumber} · ${by} · ${gateText(m)} · ${usd(m.costUsd)}${unknown}`;
    }),
  );
  section("In progress", [
    ...d.inProgress.inFlight.map((r) => `In flight: ${who(r)} · ${r.label}`),
    ...d.inProgress.readyForReview.map(
      (r) => `Ready for review: ${who(r)}${r.prNumber ? ` · PR #${r.prNumber}` : ""}`,
    ),
  ]);
  if (d.handover) lines.push(...handoverText(d.handover));
  const t = d.totals;
  const totals = [
    `${plural(t.runs, "agent task")}${t.failedRuns ? ` (${t.failedRuns} failed)` : ""}`,
    `${usd(t.costUsd)} estimated${t.unknownCostRuns ? ` (${t.unknownCostRuns} unknown)` : ""}`,
    quotaText(t.quotaDelta),
    `${t.merged} merged`,
  ].filter(Boolean);
  lines.push("", "Totals", `- ${totals.join(" · ")}`);
  if (d.truncated) {
    lines.push("", "A read cap was reached: some tickets or agent tasks may be missing.");
  }
  return lines.join("\n");
}

const NEXT_UP_STATUS: Record<DigestHandover["nextUp"][number]["status"], string> = {
  starts_now: "Starts now",
  next: "Next",
  skipped: "Skipped",
};

/** The handover's two sections as text lines, each starting with a blank line. */
export function handoverText(h: DigestHandover): string[] {
  const lines: string[] = [];
  if (h.openPrs.length) {
    lines.push("", `Open PRs (${h.openPrs.length})`);
    for (const p of h.openPrs) {
      lines.push(`- ${p.ticketKey}: ${p.title} · PR #${p.prNumber}`);
      lines.push(...p.lines.map((l) => `  - ${l}`));
    }
    if (h.openPrsTruncated) lines.push("- List cut short: more open PRs than shown.");
  }
  lines.push("", `Next up (${h.nextUp.length})`);
  for (const n of h.nextUp) {
    const why = n.reason ? ` · ${n.reason}` : "";
    lines.push(`- ${NEXT_UP_STATUS[n.status]}: ${n.ticketKey}: ${n.title}${why}`);
  }
  if (h.nextUpTruncated) lines.push("- List cut short: more Ready tickets than shown.");
  lines.push(`- ${h.idle}`);
  return lines;
}

// ── Reader ───────────────────────────────────────────────────────────────────

/**
 * Gathers a digest's data with a bounded number of reads (ADR-0028): tickets, open questions,
 * active runs, ended runs and quota, plus two reads (history, runs) per ticket that changed in
 * the window or waits in review, at most `MAX_DIGEST_TICKET_READS` tickets.
 */
export class DigestReader {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly runs: RunStore,
    private readonly quota: QuotaStore | null,
    private readonly now: () => Date = () => new Date(),
    /** AI-318: the project's tickets through the snapshot, so a call reads only what changed. */
    private readonly tickets: ProjectTickets = new ProjectTickets(tracker),
    /** AI-382: merge holds from the queue records; null: none shown. */
    private readonly holds: MergeHoldReader | null = null,
    /** AI-385: the dispatcher's facts for the next-up dry run; null: no handover. */
    private readonly dispatch: Pick<DispatchFactsReader, "facts"> | null = null,
    /** AI-385: milestones, for why a Ready ticket waits (ADR-0131); null holds those with one. */
    private readonly milestones: MilestoneReader | null = null,
  ) {}

  async digest(projectId: string, window: DigestWindow): Promise<Digest> {
    const now = this.now();
    const handover = this.handoverWanted(window, now);
    // AI-385: the handover counts agent tasks in every project, so it reads the list instead.
    const projects = handover ? await this.tracker.listProjects() : null;
    const project = projects
      ? projects.find((p) => p.id === projectId)
      : await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const from = window.from.toISOString();
    const to = window.to.toISOString();
    const [tickets, questions, activeRuns, ended, quota, quotaClears, mergeHolds] =
      await Promise.all([
        this.tickets.list(projectId),
        this.tracker.listQuestions({ projectId, status: "open" }),
        this.runs.listActive(projectId),
        this.runs.listEndedBetween(projectId, from, to, MAX_DIGEST_RUNS),
        this.quota ? this.quota.latest("claude-sub") : Promise.resolve([]),
        this.quota
          ? this.quota.clearsSince("claude-sub", from, MAX_DIGEST_QUOTA_CLEARS)
          : Promise.resolve([]),
        this.holds ? this.holds.forRepos(project.repos) : Promise.resolve([]),
      ]);

    const openQuestions = new Map<string, number>();
    for (const q of questions)
      openQuestions.set(q.ticketId, (openQuestions.get(q.ticketId) ?? 0) + 1);
    const questionLines = new Map<string, string>();
    for (const q of [...questions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (!questionLines.has(q.ticketId)) questionLines.set(q.ticketId, q.text);
    }

    // In review first (AI-385: their PRs are the handover's open PRs), then the latest changed.
    const inReview = (t: Ticket) => t.stage === "ready_for_review" && !t.archived;
    const toRead = tickets
      .filter((t) => t.updatedAt >= from || inReview(t))
      .sort(
        (a, b) =>
          Number(inReview(b)) - Number(inReview(a)) || b.updatedAt.localeCompare(a.updatedAt),
      );
    const read = toRead.slice(0, MAX_DIGEST_TICKET_READS);
    const histories = await Promise.all(
      read.map(async (t) => {
        const [events, runs] = await Promise.all([
          this.tracker.listEvents(projectId, t.id),
          this.runs.listForTicket(projectId, t.id),
        ]);
        return { id: t.id, events, runs };
      }),
    );

    const handoverData = projects
      ? await this.handoverInput(project, projects, tickets, activeRuns)
      : undefined;

    return buildDigest(window, {
      project,
      tickets,
      openQuestions,
      questionLines,
      activeRuns,
      endedRuns: ended.runs,
      ticketRuns: new Map(histories.map((h) => [h.id, h.runs])),
      ticketEvents: new Map(histories.map((h) => [h.id, h.events])),
      quota,
      quotaClears,
      mergeHolds,
      ...(handoverData ? { handover: handoverData } : {}),
      truncated: toRead.length > read.length || !ended.complete,
      now,
    });
  }

  /** The handover is gathered only for a window that reaches now, when dispatch is wired. */
  private handoverWanted(window: DigestWindow, now: Date): boolean {
    return this.dispatch !== null && window.to.getTime() >= now.getTime() - LIVE_SLACK_MS;
  }

  /**
   * The next-up dry run's own reads: the dispatcher's facts (runner, routing, quota, the other
   * projects' active tasks; none per ticket) and one read per milestone a Ready ticket is in.
   */
  private async handoverInput(
    project: Project,
    projects: readonly Project[],
    tickets: readonly Ticket[],
    active: readonly Run[],
  ): Promise<DigestData["handover"] | undefined> {
    const holds = new MilestoneHolds(this.milestones, project.id);
    const ready = tickets.filter((t) => t.stage === "ready" && t.type !== "epic" && !t.archived);
    let facts: DispatchFacts;
    let reasons: (readonly [string, string | null])[];
    try {
      [facts, reasons] = await Promise.all([
        this.dispatch!.facts(project.id, { projects, active }),
        Promise.all(ready.map(async (t) => [t.id, await holds.reasonFor(t, tickets)] as const)),
      ]);
    } catch (err) {
      // The rest of the digest still shows; the handover is left out and the failure logged.
      console.error(
        JSON.stringify({
          severity: "ERROR",
          message: "digest handover: dispatch facts unreadable",
          component: "digest",
          projectId: project.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return undefined;
    }
    const milestoneHolds = new Map(
      reasons.filter((r): r is readonly [string, string] => r[1] !== null),
    );
    return { project, milestoneHolds, facts };
  }
}
