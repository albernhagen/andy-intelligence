import type { EventActor, Ticket, WorkTracker } from "@andy/contracts";

/**
 * Sets each new ticket's `blockedBy` to the keys of the siblings its drafted indexes name
 * (refine's split, M4.3; epic breakdowns, AI-383). Run after every ticket exists, since an index
 * may point at a later one; a replay rewrites nothing that already matches. Tickets in `kept`
 * existed before and keep their blockers.
 */
export async function linkSiblingBlockers(
  tracker: Pick<WorkTracker, "updateTicket">,
  drafted: readonly { blockedBy: readonly number[] }[],
  made: readonly Ticket[],
  kept: ReadonlySet<string>,
  actor: EventActor,
): Promise<void> {
  for (const [i, child] of drafted.entries()) {
    const ticket = made[i]!;
    if (kept.has(ticket.id)) continue;
    const blockedBy = child.blockedBy.map((b) => made[b]!.key);
    if (blockedBy.join() === ticket.blockedBy.join()) continue;
    await tracker.updateTicket(ticket.projectId, ticket.id, { fields: { blockedBy } }, actor);
  }
}
