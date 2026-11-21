import type { Ticket } from "@andy/contracts";

/**
 * Milestone rules (ADR-0131, AI-302: M4.33). A milestone holds top-level epics; a child epic and
 * every ticket take the milestone of their top-level epic. Nothing reads these yet: the API and
 * MCP (AI-304: M4.34) and the dispatch rule (AI-306: M4.36) will.
 */

type Chain = Pick<Ticket, "id" | "type" | "parentId" | "milestoneId">;

/**
 * The top-level ticket above `ticket` (itself when it has no parent), walking `parentId` through
 * `tickets`. A parent missing from `tickets` ends the walk there; a cycle stops at the first repeat.
 */
export function topLevelOf<T extends Chain>(ticket: T, tickets: readonly T[]): T {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const seen = new Set<string>([ticket.id]);
  let top = ticket;
  for (
    let up = byId.get(top.parentId ?? "");
    up && !seen.has(up.id);
    up = byId.get(up.parentId ?? "")
  ) {
    seen.add(up.id);
    top = up;
  }
  return top;
}

/**
 * The milestone id `ticket` belongs to, or null: its top-level epic's `milestoneId`. Only a
 * top-level epic's own field counts, so a stale id on a ticket that later got a parent, or stopped
 * being an epic, is ignored.
 */
export function milestoneOf<T extends Chain>(ticket: T, tickets: readonly T[]): string | null {
  const top = topLevelOf(ticket, tickets);
  return top.type === "epic" ? (top.milestoneId ?? null) : null;
}

/** Why `ticket` can't be given a milestone directly, or null when it can (a top-level epic). */
export function milestoneTargetProblem(
  ticket: Pick<Ticket, "key" | "type" | "parentId">,
): string | null {
  if (ticket.type !== "epic") {
    return `only a top-level epic has a milestone; ${ticket.key} is ${ticket.type ? `a ${ticket.type}` : "untyped"} and takes its epic's`;
  }
  if (ticket.parentId) {
    return `only a top-level epic has a milestone; ${ticket.key} is a child epic and takes its top-level epic's`;
  }
  return null;
}
