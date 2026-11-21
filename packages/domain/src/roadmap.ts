import {
  compareRanks,
  notFound,
  type BoardTicket,
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
 * and counts of open stories. Computed on read, never stored; stories are grouped as the
 * milestone map groups them (`childGroup`). Reads (ADR-0028): each project's board through the
 * board's read cache (ADR-0126), so an unchanged poll reads one version counter per project; no
 * per-story agent-task reads (cost stays on the epic panel).
 */

/** Projects one all-projects roadmap reads, first by key; past it the roadmap says `truncated`. */
export const MAX_ROADMAP_PROJECTS = 50;
/** Top-level epics one project's roadmap lists; past it the roadmap says `truncated`. */
export const MAX_ROADMAP_EPICS = 50;
/** Child epics listed under one epic; past it the roadmap says `truncated` (stories still count). */
export const MAX_ROADMAP_CHILD_EPICS = 20;

export type RoadmapState = "not_started" | "in_progress" | "done";

export interface RoadmapCounts {
  /** Open stories waiting on Andy: the board's Needs me rule (ADR-0108); overlaps the others. */
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
  /** Done stories of all stories that aren't Cancelled, child epics' stories included. */
  progress: { done: number; total: number };
  counts: RoadmapCounts;
}

/** A child epic: nested one level only, so it never has children of its own. */
export interface RoadmapChildEpic extends RoadmapEpicFields {
  children: [];
}

export interface RoadmapEpic extends RoadmapEpicFields {
  /** Child epics, not archived or Cancelled, in rank order; their stories count here too. */
  children: RoadmapChildEpic[];
}

export interface ProjectRoadmap {
  projectId: string;
  projectKey: string;
  projectName: string;
  epics: RoadmapEpic[];
  /** Some top-level or child epics were left out (`MAX_ROADMAP_EPICS`, `MAX_ROADMAP_CHILD_EPICS`). */
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
 * The stories under an epic: its non-epic children, then those of its child epics at any depth
 * (not archived or Cancelled). A parent cycle is read once.
 */
function storiesUnder(epic: Ticket, tickets: readonly Ticket[], seen = new Set<string>()) {
  seen.add(epic.id);
  const children = epicChildren(epic, tickets);
  const stories = children.filter((c) => c.type !== "epic");
  for (const sub of tickets) {
    if (sub.parentId === epic.id && listed(sub) && !seen.has(sub.id)) {
      stories.push(...storiesUnder(sub, tickets, seen));
    }
  }
  return stories;
}

/** Not started: no story past Backlog (none Done either); done: the epic is Done. */
export function roadmapState(
  epic: Pick<Ticket, "stage">,
  storyStages: readonly Stage[],
): RoadmapState {
  if (epic.stage === "done") return "done";
  const started = storyStages.some((s) => s !== "backlog" && s !== "cancelled");
  return started ? "in_progress" : "not_started";
}

function fields(
  epic: Ticket,
  tickets: readonly BoardTicket[],
  byId: ReadonlyMap<string, BoardTicket>,
): RoadmapEpicFields {
  const stories = storiesUnder(epic, tickets);
  const counts: RoadmapCounts = {
    needsYou: 0,
    inReview: 0,
    inProgress: 0,
    blocked: 0,
    notStarted: 0,
  };
  let done = 0;
  let total = 0;
  for (const s of stories) {
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
      stories.map((s) => s.stage),
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

/**
 * One project's roadmap from its board tickets. Pure. Top-level epics have no parent, aren't
 * archived and aren't Cancelled; Done ones stay.
 */
export function buildRoadmap(
  project: Pick<Project, "id" | "key" | "name">,
  tickets: readonly BoardTicket[],
): ProjectRoadmap {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const top = tickets.filter((t) => listed(t) && t.parentId === null).sort(byRank);
  const cut = { truncated: top.length > MAX_ROADMAP_EPICS };
  const epics = top.slice(0, MAX_ROADMAP_EPICS).map((e) => entry(e, tickets, byId, cut));
  return {
    projectId: project.id,
    projectKey: project.key,
    projectName: project.name,
    epics,
    truncated: cut.truncated,
  };
}

/** Reads roadmaps: one project's, or every readable project's (first 50 by key). */
export class RoadmapReader {
  constructor(
    private readonly tracker: Pick<WorkTracker, "getProject" | "listProjects">,
    private readonly board: BoardSource,
  ) {}

  async project(projectId: string): Promise<ProjectRoadmap> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    return buildRoadmap(project, await this.board.tickets(projectId));
  }

  /** `canRead` leaves out projects the caller may not read, before the project cap. */
  async all(canRead: (projectId: string) => Promise<boolean>): Promise<Roadmap> {
    const all = [...(await this.tracker.listProjects())].sort((a, b) => a.key.localeCompare(b.key));
    const allowed = await Promise.all(all.map((p) => canRead(p.id)));
    const readable = all.filter((_, i) => allowed[i]);
    const projects = readable.slice(0, MAX_ROADMAP_PROJECTS);
    const boards = await Promise.all(projects.map((p) => this.board.tickets(p.id)));
    return {
      projects: projects.map((p, i) => buildRoadmap(p, boards[i]!)),
      truncated: readable.length > MAX_ROADMAP_PROJECTS,
    };
  }
}
