import {
  Stage,
  compareRanks,
  notFound,
  type BoardTicket,
  type Project,
  type WorkTracker,
} from "@andy/contracts";
import { openBlockers } from "./status-line";
import { WORK_VIEWS, workViewCounts, workViews, type WorkView } from "./work-views";

/** Projects one work list reads (ADR-0028); past it the list says `truncated`. */
export const MAX_WORK_PROJECTS = 50;
/** Tickets one work list returns (ADR-0028); past it the list says `truncated`. */
export const MAX_WORK_TICKETS = 200;

/** A ticket in a work list: its board card, plus the keys of blockers not finished yet. */
export type WorkTicket = BoardTicket & { blockers: string[] };

export type WorkProject = {
  id: string;
  key: string;
  name: string;
  /** Tickets in the view in this project, before the ticket cap. */
  count: number;
  tickets: WorkTicket[];
};

export type WorkList = {
  view: WorkView;
  /** Open tickets per view across the projects read: the chips' counts. */
  counts: Record<WorkView, number>;
  projects: WorkProject[];
  truncated: boolean;
};

/** The board's cached read (BoardReader), so a work poll costs what board polls cost. */
export interface BoardSource {
  tickets(projectId: string): Promise<BoardTicket[]>;
}

const STAGES: readonly Stage[] = Stage.options;

/**
 * One fixed work view across projects (AI-198, ADR-0108 decision 5): every project's open
 * tickets in the view, grouped by project (key order), each project's by stage then rank.
 * Reads the project list and each project's board through the board's read cache: a poll while
 * nothing changed reads the projects and one version counter per project (ADR-0126).
 */
export class WorkReader {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly board: BoardSource,
  ) {}

  async list(view: WorkView, projectId?: string): Promise<WorkList> {
    let projects: Project[];
    let truncated = false;
    if (projectId) {
      const project = await this.tracker.getProject(projectId);
      if (!project) throw notFound("project", projectId);
      projects = [project];
    } else {
      const all = [...(await this.tracker.listProjects())].sort((a, b) =>
        a.key.localeCompare(b.key),
      );
      truncated = all.length > MAX_WORK_PROJECTS;
      projects = all.slice(0, MAX_WORK_PROJECTS);
    }

    const boards = await Promise.all(projects.map((p) => this.board.tickets(p.id)));
    const counts = Object.fromEntries(WORK_VIEWS.map((v) => [v, 0])) as Record<WorkView, number>;
    let room = MAX_WORK_TICKETS;
    const groups: WorkProject[] = projects.map((project, i) => {
      const tickets = boards[i]!;
      const byId = new Map(tickets.map((t) => [t.id, t]));
      const projectCounts = workViewCounts(tickets, byId);
      for (const v of WORK_VIEWS) counts[v] += projectCounts[v];
      const matches = tickets
        .filter((t) => workViews(t, byId).includes(view))
        .sort(
          (a, b) =>
            STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || compareRanks(a.rank, b.rank),
        );
      const kept = matches.slice(0, room);
      room -= kept.length;
      if (kept.length < matches.length) truncated = true;
      return {
        id: project.id,
        key: project.key,
        name: project.name,
        count: matches.length,
        tickets: kept.map((t) => ({ ...t, blockers: openBlockers(t, byId).map((b) => b.key) })),
      };
    });
    return { view, counts, projects: groups.filter((g) => g.count > 0), truncated };
  }
}
