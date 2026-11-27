import { notFound, type Project, type Stage, type Ticket, type WorkTracker } from "@andy/contracts";
import { epicChildren, type EpicChild } from "./epic-rollup";
import { epicStateOf, type EpicState } from "./epic-state";
import { DomainError } from "./errors";
import { ProjectTickets } from "./ticket-snapshots";

/**
 * The milestone map (AI-148): for each open epic of a project, which children are done, in
 * review (with the PR), in progress, blocked (and on what) or not started. Computed on read from
 * ticket data, never stored or hand-edited; it replaces the table that lived in
 * `docs/build-log.md`. Reads: the project's ticket list once, and the history of at most
 * `MAX_MAP_PR_READS` tickets in review for their PR number (ADR-0028).
 */

/** Open epics one map shows, in rank order; past it the map says `truncated.epics`. */
export const MAX_MAP_EPICS = 20;
/** Ticket histories read for the PR number of tickets in review; past it the number is null. */
export const MAX_MAP_PR_READS = 50;
/** Open tickets under no epic listed by key; past it the map says `truncated.unassigned`. */
export const MAX_MAP_UNASSIGNED = 50;

export interface MapItem {
  key: string;
  title: string;
  /** The last PR linked to the ticket; only read for tickets in review, else null. */
  prNumber: number | null;
  /** Keys of blockers not yet Done; a blocker in another project counts as open. */
  openBlockers: string[];
  /** Waiting on Andy: an open question, a closed PR or a failed agent task (Needs-you). */
  needsAttention: boolean;
}

export interface MilestoneMapEpic {
  key: string;
  title: string;
  stage: Stage;
  /** Its state, read from its stage as the roadmap reads it (ADR-0164). */
  state: EpicState;
  /** Done children of all children that aren't Cancelled. */
  progress: { done: number; total: number };
  /** Keys only: the done list grows and needs no detail. */
  done: string[];
  inReview: MapItem[];
  inProgress: MapItem[];
  /** Backlog or Ready with a blocker not yet Done. */
  blocked: MapItem[];
  /** Backlog or Ready with nothing blocking. */
  notStarted: MapItem[];
  cancelled: number;
}

export interface MilestoneMap {
  projectKey: string;
  epics: MilestoneMapEpic[];
  /** Keys of open (not Done or Cancelled), non-epic tickets whose parent is no epic. */
  unassigned: string[];
  truncated: { epics: boolean; prNumbers: boolean; unassigned: boolean };
  /** The map as plain text, one block per epic. */
  text: string;
}

const isOpen = (s: Stage) => s !== "done" && s !== "cancelled";
const byRank = (a: Ticket, b: Ticket) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);

/**
 * The epics a map shows: the one named by `epicKey` (any stage), else every open, non-archived
 * epic in rank order. A key that names no epic of the project is refused.
 */
export function mapEpics(tickets: readonly Ticket[], epicKey?: string): Ticket[] {
  const epics = tickets.filter((t) => t.type === "epic" && !t.archived).sort(byRank);
  if (epicKey === undefined) return epics.filter((e) => isOpen(e.stage));
  const one = epics.find((e) => e.key === epicKey);
  if (!one) throw new DomainError("invalid_reference", `${epicKey} is not an epic of this project`);
  return [one];
}

/**
 * The tickets in review (or Verifying, AI-181: merged, not yet Done) under the given epics, whose
 * PR numbers the map reads.
 */
export function inReviewUnder(epics: readonly Ticket[], tickets: readonly Ticket[]): Ticket[] {
  const ids = new Set(epics.map((e) => e.id));
  return tickets.filter(
    (t) => t.parentId !== null && ids.has(t.parentId) && !t.archived && inReviewGroup(t.stage),
  );
}

/** Ready for review and Verifying count together as "in review" on the map and roadmap. */
function inReviewGroup(stage: Ticket["stage"]): boolean {
  return stage === "ready_for_review" || stage === "verifying";
}

/** Where a child stands, the groups the map and the roadmap (AI-193) both count by. */
export type ChildGroup =
  "done" | "inReview" | "inProgress" | "blocked" | "notStarted" | "cancelled";

/** Backlog or Ready is blocked with a blocker not yet Done, else not started. */
export function childGroup(c: Pick<EpicChild, "stage" | "openBlockers">): ChildGroup {
  switch (c.stage) {
    case "done":
    case "cancelled":
      return c.stage;
    case "ready_for_review":
    case "verifying":
      return "inReview";
    case "in_progress":
      return "inProgress";
    default:
      return c.openBlockers.length > 0 ? "blocked" : "notStarted";
  }
}

function item(c: EpicChild, byId: Map<string, Ticket>, prs: ReadonlyMap<string, number>): MapItem {
  return {
    key: c.key,
    title: c.title,
    prNumber: prs.get(c.id) ?? null,
    openBlockers: c.openBlockers,
    needsAttention: byId.get(c.id)?.needsAttention ?? false,
  };
}

function epicEntry(
  epic: Ticket,
  tickets: readonly Ticket[],
  byId: Map<string, Ticket>,
  prs: ReadonlyMap<string, number>,
): MilestoneMapEpic {
  const children = epicChildren(epic, tickets);
  const of = (group: ChildGroup) =>
    children.filter((c) => childGroup(c) === group).map((c) => item(c, byId, prs));
  const counted = children.filter((c) => c.stage !== "cancelled");
  return {
    key: epic.key,
    title: epic.title,
    stage: epic.stage,
    state: epicStateOf(epic.stage),
    progress: { done: counted.filter((c) => c.stage === "done").length, total: counted.length },
    done: children.filter((c) => c.stage === "done").map((c) => c.key),
    inReview: of("inReview"),
    inProgress: of("inProgress"),
    blocked: of("blocked"),
    notStarted: of("notStarted"),
    cancelled: children.length - counted.length,
  };
}

/**
 * The map from the project's tickets and the PR numbers read for tickets in review (by ticket
 * id). Pure: same data, same map. `prsTruncated`: some tickets in review weren't read.
 */
export function buildMilestoneMap(
  project: Pick<Project, "key">,
  tickets: readonly Ticket[],
  prs: ReadonlyMap<string, number>,
  options: { epicKey?: string; prsTruncated?: boolean } = {},
): MilestoneMap {
  const all = mapEpics(tickets, options.epicKey);
  const epics = all.slice(0, MAX_MAP_EPICS);
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const isEpic = (id: string | null) => id !== null && byId.get(id)?.type === "epic";
  const unassignedAll =
    options.epicKey === undefined
      ? tickets
          .filter((t) => t.type !== "epic" && !t.archived && isOpen(t.stage) && !isEpic(t.parentId))
          .sort(byRank)
          .map((t) => t.key)
      : [];
  const map: Omit<MilestoneMap, "text"> = {
    projectKey: project.key,
    epics: epics.map((e) => epicEntry(e, tickets, byId, prs)),
    unassigned: unassignedAll.slice(0, MAX_MAP_UNASSIGNED),
    truncated: {
      epics: all.length > epics.length,
      prNumbers: options.prsTruncated ?? false,
      unassigned: unassignedAll.length > MAX_MAP_UNASSIGNED,
    },
  };
  return { ...map, text: renderMilestoneMapText(map) };
}

const itemText = (i: MapItem) => {
  const notes = [
    ...(i.prNumber !== null ? [`PR #${i.prNumber}`] : []),
    ...(i.openBlockers.length > 0 ? [`on ${i.openBlockers.join(", ")}`] : []),
    ...(i.needsAttention ? ["needs Andy"] : []),
  ];
  return notes.length > 0 ? `${i.key} (${notes.join("; ")})` : i.key;
};

/** One block per epic: a line per non-empty group, keys with PR, blockers and Needs-you. */
export function renderMilestoneMapText(map: Omit<MilestoneMap, "text">): string {
  const lines = [`${map.projectKey} milestone map (from tickets)`];
  if (map.epics.length === 0) lines.push("No open epics.");
  for (const e of map.epics) {
    const waiting = e.state === "waiting_for_check" ? " · waiting for your check" : "";
    lines.push(
      "",
      `${e.key}: ${e.title}: ${e.progress.done} of ${e.progress.total} done${waiting}`,
    );
    const groups: [string, string[]][] = [
      ["Done", e.done],
      ["In review", e.inReview.map(itemText)],
      ["In progress", e.inProgress.map(itemText)],
      ["Blocked", e.blocked.map(itemText)],
      ["Not started", e.notStarted.map(itemText)],
    ];
    for (const [label, keys] of groups) {
      if (keys.length > 0) lines.push(`  ${label}: ${keys.join(", ")}`);
    }
  }
  if (map.unassigned.length > 0) {
    lines.push("", `Under no epic: ${map.unassigned.join(", ")}`);
  }
  const cut = [
    ...(map.truncated.epics ? [`only the first ${MAX_MAP_EPICS} epics`] : []),
    ...(map.truncated.prNumbers ? [`PR numbers for the first ${MAX_MAP_PR_READS} in review`] : []),
    ...(map.truncated.unassigned ? [`the first ${MAX_MAP_UNASSIGNED} under no epic`] : []),
  ];
  if (cut.length > 0) lines.push("", `Partial: ${cut.join("; ")}.`);
  return lines.join("\n");
}

/** Reads a project's map: its ticket list, then histories of tickets in review (capped). */
export class MilestoneMapReader {
  constructor(
    private readonly tracker: Pick<
      WorkTracker,
      "getProject" | "listTickets" | "getLatestPullRequest"
    >,
    /** AI-318: the project's tickets through the snapshot, so a call reads only what changed. */
    private readonly tickets: ProjectTickets = new ProjectTickets(tracker),
  ) {}

  async map(projectId: string, epicKey?: string): Promise<MilestoneMap> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const tickets = await this.tickets.list(projectId);
    const all = mapEpics(tickets, epicKey).slice(0, MAX_MAP_EPICS);
    const review = inReviewUnder(all, tickets).sort(byRank);
    const read = review.slice(0, MAX_MAP_PR_READS);
    const numbers = await Promise.all(
      // Only the ticket's PR links, not its whole history (AI-318).
      read.map(async (t) => (await this.tracker.getLatestPullRequest(projectId, t.id))?.number),
    );
    const prs = new Map<string, number>();
    read.forEach((t, i) => {
      const n = numbers[i];
      if (n !== null && n !== undefined) prs.set(t.id, n);
    });
    return buildMilestoneMap(project, tickets, prs, {
      epicKey,
      prsTruncated: review.length > read.length,
    });
  }
}
