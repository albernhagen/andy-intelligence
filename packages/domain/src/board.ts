import {
  Stage as StageSchema,
  compareRanks,
  notFound,
  type BoardTicket,
  type Run,
  type RunStore,
  type Stage,
  type WorkTracker,
} from "@andy/contracts";

import type { ProjectReadCache } from "./project-versions";
import type { TicketSnapshots } from "./ticket-snapshots";
import { resolveWorker } from "./worker";
import { epicOf } from "./overrides";

/** Stages whose cards show a pull request; Backlog, Ready and Done ones skip the history read. */
export const PR_STAGES: readonly Stage[] = ["in_progress", "ready_for_review"];

/**
 * Cap on pull request reads per board request (ADR-0028): one per card in `PR_STAGES`, reading
 * only that card's `pr_linked` events. Cards past it show no PR. A board with more work in flight than this is not a board Andy can read anyway.
 */
export const MAX_PR_LOOKUPS = 50;

/**
 * The board's tickets with what each card shows (AI-28: Board v2): open questions, the run in
 * flight, the latest pull request. A fixed number of reads per board (tickets, open questions,
 * active runs) plus one PR link read per card in `PR_STAGES`, so the UI makes one request, not
 * one per card. With the read cache, a poll while nothing changed reads only the project's
 * version (AI-222); with the snapshots too, a poll after a write reads only the changed tickets
 * (AI-317).
 */
export class BoardReader {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly runs: RunStore,
    /** AI-222: with it, an unchanged board (same project version) is one document read. */
    private readonly cache: ProjectReadCache | null = null,
    /** AI-317: with it (and the cache), a changed board reads only the changed tickets. */
    private readonly snapshots: TicketSnapshots | null = null,
  ) {}

  async tickets(projectId: string): Promise<BoardTicket[]> {
    return this.cache
      ? this.cache.get(projectId, "board", (version) => this.read(projectId, version))
      : this.read(projectId);
  }

  private async read(projectId: string, version?: number): Promise<BoardTicket[]> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const [tickets, questions, active] = await Promise.all([
      this.snapshots && version !== undefined
        ? this.snapshots.tickets(projectId, version)
        : this.tracker.listTickets(projectId),
      this.tracker.listQuestions({ projectId, status: "open" }),
      this.runs.listActive(projectId),
    ]);

    const openQuestions = new Map<string, number>();
    for (const q of questions)
      openQuestions.set(q.ticketId, (openQuestions.get(q.ticketId) ?? 0) + 1);

    // listActive is newest first: the first run seen per ticket is its newest.
    const runs = new Map<string, Run>();
    for (const r of active) if (r.ticketId && !runs.has(r.ticketId)) runs.set(r.ticketId, r);

    const withPr = tickets
      .filter((t) => !t.archived && PR_STAGES.includes(t.stage))
      .slice(0, MAX_PR_LOOKUPS);
    const prs = new Map(
      await Promise.all(
        withPr.map(
          async (t) => [t.id, await this.tracker.getLatestPullRequest(projectId, t.id)] as const,
        ),
      ),
    );

    return tickets.map((t) => {
      const run = runs.get(t.id);
      return {
        ...t,
        summary: {
          openQuestions: openQuestions.get(t.id) ?? 0,
          run: run
            ? {
                id: run.id,
                step: run.step,
                status: run.status,
                startedAt: run.startedAt,
                createdAt: run.createdAt,
              }
            : null,
          pullRequest: prs.get(t.id) ?? null,
          // AI-116: a child without its own pick takes its epic's.
          worker: resolveWorker(t, project, epicOf(t, tickets)),
        },
      };
    });
  }
}

/** What a lane needs of a ticket. */
type LaneTicket = Pick<BoardTicket, "stage" | "rank" | "archived">;

/** A board lane: one stage's tickets in rank order (AI-296). */
export interface BoardLane<T extends LaneTicket = BoardTicket> {
  stage: Stage;
  tickets: T[];
}

/**
 * The board's lanes in workflow order: the Cancelled lane only with `showArchived` (the board's
 * "Show cancelled and archived"). The web board and MCP `board` both use it (AI-296).
 */
export function boardStages(showArchived: boolean): Stage[] {
  return StageSchema.options.filter((s) => s !== "cancelled" || showArchived);
}

/** Whether a ticket shows on the board: archived ones only with `showArchived` (AI-15). */
export function onBoard(ticket: Pick<BoardTicket, "archived">, showArchived: boolean): boolean {
  return showArchived || !ticket.archived;
}

/**
 * The board's lanes, as the web board shows them (AI-296: Parity: the board, over MCP): each of
 * `boardStages` (or only `stage`), with the tickets `onBoard` in rank order. The web board groups
 * its cards with it too, so the two can't drift.
 */
export function boardLanes<T extends LaneTicket>(
  tickets: readonly T[],
  options: { stage?: Stage; showArchived?: boolean } = {},
): BoardLane<T>[] {
  const showArchived = options.showArchived ?? false;
  const stages = options.stage ? [options.stage] : boardStages(showArchived);
  return stages.map((stage) => ({
    stage,
    tickets: tickets
      .filter((t) => t.stage === stage && onBoard(t, showArchived))
      .sort((a, b) => compareRanks(a.rank, b.rank)),
  }));
}
