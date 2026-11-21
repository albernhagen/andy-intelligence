import type { Milestone, MilestoneStore, Ticket, WorkTracker } from "@andy/contracts";
import { milestoneOf, topLevelOf } from "./milestones";

/**
 * The dispatch rule for milestones (ADR-0131, AI-306: M4.36): refine, build and night launch
 * start a ticket only when its milestone is approved or it has none. A ticket held back stays
 * where it is, with the reason. Fail closed: a milestone that can't be read, or a ticket whose
 * epic chain isn't fully loaded, holds the ticket.
 */

export type MilestoneReader = Pick<MilestoneStore, "get">;

/** The epic levels above a ticket: its epic and, for a child epic, the top-level one (ADR-0131). */
const CHAIN_DEPTH = 2;

function log(message: string, fields: object) {
  console.log(
    JSON.stringify({ severity: "WARNING", message, component: "milestone-holds", ...fields }),
  );
}

/** Why a ticket in milestone `id` waits, or null when the milestone is approved. */
export function milestoneHoldReason(id: string, milestone: Milestone | null): string | null {
  if (milestone === null) return `Milestone ${id} can't be read`;
  if (milestone.status === "approved") return null;
  return `Milestone ${milestone.name} is ${milestone.status === "parked" ? "parked" : "not reviewed"}`;
}

/**
 * One dispatch pass's milestone reads: each milestone is read once (`get`, never the project's
 * list), and only for tickets that have one. A null store holds every ticket that has a milestone.
 */
export class MilestoneHolds {
  private readonly read = new Map<string, Promise<Milestone | null>>();

  constructor(
    private readonly store: MilestoneReader | null,
    private readonly projectId: string,
  ) {}

  /**
   * Why `ticket` waits, or null when it may start. `tickets` must hold its epic chain (its epic
   * and that epic's parent); a chain that ends at a ticket missing from it holds the ticket.
   */
  async reasonFor(ticket: Ticket, tickets: readonly Ticket[]): Promise<string | null> {
    const top = topLevelOf(ticket, tickets);
    if (top.parentId) return "Milestone can't be read: its epic wasn't found";
    const id = milestoneOf(ticket, tickets);
    return id === null ? null : milestoneHoldReason(id, await this.milestone(id));
  }

  private milestone(id: string): Promise<Milestone | null> {
    let pending = this.read.get(id);
    if (!pending) {
      pending = this.store
        ? this.store.get(this.projectId, id).catch((err: unknown) => {
            log("milestone not read: its tickets wait", {
              projectId: this.projectId,
              id,
              error: String(err),
            });
            return null;
          })
        : Promise.resolve(null);
      this.read.set(id, pending);
    }
    return pending;
  }
}

/**
 * The tickets above `ticket` (its epic, and a child epic's parent) not already in `known`, read
 * one `getTicket` each: at most two reads, none for a ticket without a parent. A parent that
 * doesn't exist is left out, so `MilestoneHolds.reasonFor` holds the ticket.
 */
export async function epicChainOf(
  tracker: Pick<WorkTracker, "getTicket">,
  ticket: Ticket,
  known: readonly Ticket[] = [],
): Promise<Ticket[]> {
  const byId = new Map(known.map((t) => [t.id, t]));
  const chain: Ticket[] = [];
  let next = ticket.parentId;
  for (let depth = 0; next && depth < CHAIN_DEPTH; depth += 1) {
    const parent = byId.get(next) ?? (await tracker.getTicket(ticket.projectId, next));
    if (!parent) break;
    if (!byId.has(parent.id)) chain.push(parent);
    next = parent.parentId;
  }
  return chain;
}

/**
 * Why `ticket` waits on its milestone, for its status line (AI-306): only in Ready and in Up
 * next (refine takes it), else null. Reads at most its two epics (none already in `known`) and
 * its milestone.
 */
export async function ticketMilestoneHold(
  tracker: Pick<WorkTracker, "getTicket">,
  milestones: MilestoneReader | null,
  ticket: Ticket,
  known: readonly Ticket[] = [],
): Promise<string | null> {
  // Ideas (Backlog, not in Up next) never dispatch, so their line stays "Backlog · …".
  const dispatches =
    ticket.stage === "ready" || (ticket.stage === "backlog" && ticket.upNextRank !== null);
  if (!dispatches) return null;
  const chain = [...known, ...(await epicChainOf(tracker, ticket, known))];
  return new MilestoneHolds(milestones, ticket.projectId).reasonFor(ticket, chain);
}
