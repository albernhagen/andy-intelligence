import {
  PullRequestLink,
  notFound,
  type BoardTicket,
  type Run,
  type RunStore,
  type Stage,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";

import { resolveWorker } from "./worker";

/** Stages whose cards show a pull request; Backlog, Ready and Done ones skip the history read. */
export const PR_STAGES: readonly Stage[] = ["in_progress", "ready_for_review"];

/**
 * Cap on history reads per board request (ADR-0028): one per card in `PR_STAGES`. Cards past it
 * show no PR. A board with more work in flight than this is not a board Andy can read anyway.
 */
export const MAX_PR_LOOKUPS = 50;

/**
 * The board's tickets with what each card shows (AI-28: Board v2): open questions, the run in
 * flight, the latest pull request. A fixed number of reads per board (tickets, open questions,
 * active runs) plus one history read per card in `PR_STAGES`, so the UI makes one request, not
 * one per card.
 */
export class BoardReader {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly runs: RunStore,
  ) {}

  async tickets(projectId: string): Promise<BoardTicket[]> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const [tickets, questions, active] = await Promise.all([
      this.tracker.listTickets(projectId),
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
      await Promise.all(withPr.map(async (t) => [t.id, await this.latestPr(t)] as const)),
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
          worker: resolveWorker(t, project),
        },
      };
    });
  }

  private async latestPr(ticket: Ticket): Promise<PullRequestLink | null> {
    const events = await this.tracker.listEvents(ticket.projectId, ticket.id);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!.kind !== "pr_linked") continue;
      const link = PullRequestLink.safeParse(events[i]!.data);
      if (link.success) return link.data;
    }
    return null;
  }
}
