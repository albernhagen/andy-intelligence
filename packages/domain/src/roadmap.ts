import {
  MILESTONES_PER_PROJECT_MAX,
  byMilestoneOrder,
  compareRanks,
  notFound,
  type BoardTicket,
  type Milestone,
  type MilestoneStatus,
  type MilestoneStore,
  type Project,
  type Stage,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { epicChildren } from "./epic-rollup";
import { childGroup } from "./milestone-map";
import type { BoardSource } from "./work-list";
import { workViews } from "./work-views";

/**
 * The roadmap (AI-193: M4.25, ADR-0108 decisions 1 and 2): a project's top-level epics in rank
 * order, child epics nested one level, each with its outcome, "Done when" lines, a state, progress
 * and counts of open tickets. Computed on read, never stored; tickets are grouped as the
 * milestone map groups them (`childGroup`). Reads (ADR-0028): each project's board through the
 * board's read cache (ADR-0126), so an unchanged poll reads one version counter per project; no
 * per-ticket agent-task reads (cost stays on the epic panel).
 *
 * Milestones (AI-305: M4.35, ADR-0131): the project's milestones in order, each with its status,
 * whether it is done (computed: approved, with every epic Done), progress and counts summed over
 * its epics, and its epics' keys; epics with no milestone are listed under `noMilestone`. One
 * milestone-list read per project, capped at 50 (ADR-0028). `epics` keeps its AI-193 shape.
 */

/** Projects one all-projects roadmap reads, first by key; past it the roadmap says `truncated`. */
export const MAX_ROADMAP_PROJECTS = 50;
/** Top-level epics one project's roadmap lists; past it the roadmap says `truncated`. */
export const MAX_ROADMAP_EPICS = 50;
/** Child epics listed under one epic; past it the roadmap says `truncated` (tickets still count). */
export const MAX_ROADMAP_CHILD_EPICS = 20;

export type RoadmapState = "not_started" | "in_progress" | "done";

export interface RoadmapCounts {
  /** Open tickets waiting on Andy: the board's Needs you rule (ADR-0108); overlaps the others. */
  needsYou: number;
  inReview: number;
  inProgress: number;
  /** Backlog or Ready with a blocker not yet Done. */
  blocked: number;
  /** Backlog or Ready with nothing blocking. */
  notStarted: number;
}

interface RoadmapEpicFields {
  key: string;
  title: string;
  /** What is true when it is done (AI-186); null until someone writes one. */
  outcome: string | null;
  /** Its acceptance criteria, shown as "Done when" on epics. */
  doneWhen: string[];
  stage: Stage;
  state: RoadmapState;
  /** Done tickets of all tickets that aren't Cancelled, child epics' tickets included. */
  progress: { done: number; total: number };
  counts: RoadmapCounts;
}

/** A child epic: nested one level only, so it never has children of its own. */
export interface RoadmapChildEpic extends RoadmapEpicFields {
  children: [];
}

export interface RoadmapEpic extends RoadmapEpicFields {
  /** Child epics, not archived or Cancelled, in rank order; their tickets count here too. */
  children: RoadmapChildEpic[];
}

export interface RoadmapMilestone {
  id: string;
  name: string;
  outcome: string;
  order: number;
  /** As stored: `not_reviewed`, `approved` or `parked` (screens dim parked ones). */
  status: MilestoneStatus;
  /** Computed, never stored: approved, with at least one epic and every epic Done. */
  done: boolean;
  /** Summed over its epics (child epics' tickets included). */
  progress: { done: number; total: number };
  counts: RoadmapCounts;
  /** Its top-level epics' keys in rank order; each is in `epics` unless that list was cut. */
  epicKeys: string[];
}

export interface ProjectRoadmap {
  projectId: string;
  projectKey: string;
  projectName: string;
  /** The project's milestones in roadmap order (`byMilestoneOrder`). */
  milestones: RoadmapMilestone[];
  /**
   * Keys of top-level epics with no milestone, in rank order. An epic naming a milestone that
   * isn't listed is here only when the list wasn't cut; past the cap it is left out (`truncated`).
   */
  noMilestone: string[];
  epics: RoadmapEpic[];
  /**
   * Something was left out: top-level or child epics (`MAX_ROADMAP_EPICS`,
   * `MAX_ROADMAP_CHILD_EPICS`), or milestones past `MILESTONES_PER_PROJECT_MAX`.
   */
  truncated: boolean;
}

export interface Roadmap {
  projects: ProjectRoadmap[];
  /** More readable projects than `MAX_ROADMAP_PROJECTS`. */
  truncated: boolean;
}

const byRank = (a: Ticket, b: Ticket) => compareRanks(a.rank, b.rank);
const listed = (t: Ticket) => t.type === "epic" && !t.archived && t.stage !== "cancelled";

/**
 * The tickets under an epic: its non-epic children, then those of its child epics at any depth
 * (not archived or Cancelled). A parent cycle is read once.
 */
function ticketsUnder(epic: Ticket, tickets: readonly Ticket[], seen = new Set<string>()) {
  seen.add(epic.id);
  const under = epicChildren(epic, tickets).filter((c) => c.type !== "epic");
  for (const sub of tickets) {
    if (sub.parentId === epic.id && listed(sub) && !seen.has(sub.id)) {
      under.push(...ticketsUnder(sub, tickets, seen));
    }
  }
  return under;
}

/** Not started: no ticket past Backlog (none Done either); done: the epic is Done. */
export function roadmapState(
  epic: Pick<Ticket, "stage">,
  ticketStages: readonly Stage[],
): RoadmapState {
  if (epic.stage === "done") return "done";
  const started = ticketStages.some((s) => s !== "backlog" && s !== "cancelled");
  return started ? "in_progress" : "not_started";
}

function fields(
  epic: Ticket,
  tickets: readonly BoardTicket[],
  byId: ReadonlyMap<string, BoardTicket>,
): RoadmapEpicFields {
  const under = ticketsUnder(epic, tickets);
  const counts: RoadmapCounts = {
    needsYou: 0,
    inReview: 0,
    inProgress: 0,
    blocked: 0,
    notStarted: 0,
  };
  let done = 0;
  let total = 0;
  for (const s of under) {
    const group = childGroup(s);
    if (group === "cancelled") continue;
    total += 1;
    if (group === "done") {
      done += 1;
      continue;
    }
    counts[group] += 1;
    const ticket = byId.get(s.id);
    if (ticket && workViews(ticket, byId).includes("needs-me")) counts.needsYou += 1;
  }
  return {
    key: epic.key,
    title: epic.title,
    outcome: epic.outcome,
    doneWhen: epic.acceptanceCriteria,
    stage: epic.stage,
    state: roadmapState(
      epic,
      under.map((s) => s.stage),
    ),
    progress: { done, total },
    counts,
  };
}

function entry(
  epic: Ticket,
  tickets: readonly BoardTicket[],
  byId: ReadonlyMap<string, BoardTicket>,
  cut: { truncated: boolean },
): RoadmapEpic {
  const subs = tickets.filter((t) => t.parentId === epic.id && listed(t)).sort(byRank);
  if (subs.length > MAX_ROADMAP_CHILD_EPICS) cut.truncated = true;
  return {
    ...fields(epic, tickets, byId),
    children: subs
      .slice(0, MAX_ROADMAP_CHILD_EPICS)
      .map((sub) => ({ ...fields(sub, tickets, byId), children: [] })),
  };
}

const sum = (a: RoadmapCounts, b: RoadmapCounts): RoadmapCounts => ({
  needsYou: a.needsYou + b.needsYou,
  inReview: a.inReview + b.inReview,
  inProgress: a.inProgress + b.inProgress,
  blocked: a.blocked + b.blocked,
  notStarted: a.notStarted + b.notStarted,
});
const NO_COUNTS: RoadmapCounts = {
  needsYou: 0,
  inReview: 0,
  inProgress: 0,
  blocked: 0,
  notStarted: 0,
};

/** A milestone's row: its epics' roll-ups summed, and done when approved with every epic Done. */
function milestoneEntry(m: Milestone, epics: readonly RoadmapEpicFields[]): RoadmapMilestone {
  return {
    id: m.id,
    name: m.name,
    outcome: m.outcome,
    order: m.order,
    status: m.status,
    done: m.status === "approved" && epics.length > 0 && epics.every((e) => e.stage === "done"),
    progress: {
      done: epics.reduce((n, e) => n + e.progress.done, 0),
      total: epics.reduce((n, e) => n + e.progress.total, 0),
    },
    counts: epics.reduce((c, e) => sum(c, e.counts), NO_COUNTS),
    epicKeys: epics.map((e) => e.key),
  };
}

/**
 * One project's roadmap from its board tickets and milestones. Pure. Top-level epics have no
 * parent, aren't archived and aren't Cancelled; Done ones stay. An epic belongs to the milestone
 * its `milestoneId` names (only top-level epics hold one, ADR-0131).
 */
export function buildRoadmap(
  project: Pick<Project, "id" | "key" | "name">,
  tickets: readonly BoardTicket[],
  milestones: readonly Milestone[] = [],
): ProjectRoadmap {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const top = tickets.filter((t) => listed(t) && t.parentId === null).sort(byRank);
  const cut = { truncated: top.length > MAX_ROADMAP_EPICS };
  const epics = top.slice(0, MAX_ROADMAP_EPICS).map((e) => entry(e, tickets, byId, cut));
  const ordered = [...milestones].sort(byMilestoneOrder);
  const known = new Set(ordered.map((m) => m.id));
  // A list at the store's cap may have been cut: an epic naming an unlisted milestone may belong
  // to one past it, so it isn't called "no milestone" and the roadmap says it is partial.
  const listCut = milestones.length >= MILESTONES_PER_PROJECT_MAX;
  const unlisted = (e: Ticket) => e.milestoneId !== null && !known.has(e.milestoneId);
  // Every top-level epic counts in its milestone, even one past the `epics` cap.
  const rolled = top.map((e) => ({ epic: e, fields: fields(e, tickets, byId) }));
  return {
    projectId: project.id,
    projectKey: project.key,
    projectName: project.name,
    milestones: ordered.map((m) =>
      milestoneEntry(
        m,
        rolled.filter((r) => r.epic.milestoneId === m.id).map((r) => r.fields),
      ),
    ),
    noMilestone: top
      .filter((e) => e.milestoneId === null || (unlisted(e) && !listCut))
      .map((e) => e.key),
    epics,
    truncated: cut.truncated || (listCut && top.some(unlisted)),
  };
}

/** Reads roadmaps: one project's, or every readable project's (first 50 by key). */
export class RoadmapReader {
  constructor(
    private readonly tracker: Pick<WorkTracker, "getProject" | "listProjects">,
    private readonly board: BoardSource,
    /** AI-305: one list read per project; without it every epic is under `noMilestone`. */
    private readonly milestones: Pick<MilestoneStore, "list"> | null = null,
  ) {}

  private async milestonesOf(projectId: string): Promise<Milestone[]> {
    return this.milestones ? this.milestones.list(projectId) : [];
  }

  async project(projectId: string): Promise<ProjectRoadmap> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const [tickets, milestones] = await Promise.all([
      this.board.tickets(projectId),
      this.milestonesOf(projectId),
    ]);
    return buildRoadmap(project, tickets, milestones);
  }

  /** `canRead` leaves out projects the caller may not read, before the project cap. */
  async all(canRead: (projectId: string) => Promise<boolean>): Promise<Roadmap> {
    const all = [...(await this.tracker.listProjects())].sort((a, b) => a.key.localeCompare(b.key));
    const allowed = await Promise.all(all.map((p) => canRead(p.id)));
    const readable = all.filter((_, i) => allowed[i]);
    const projects = readable.slice(0, MAX_ROADMAP_PROJECTS);
    const [boards, milestones] = await Promise.all([
      Promise.all(projects.map((p) => this.board.tickets(p.id))),
      Promise.all(projects.map((p) => this.milestonesOf(p.id))),
    ]);
    return {
      projects: projects.map((p, i) => buildRoadmap(p, boards[i]!, milestones[i]!)),
      truncated: readable.length > MAX_ROADMAP_PROJECTS,
    };
  }
}
