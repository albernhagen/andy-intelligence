import type { Milestone, Ticket } from "@andy/contracts";

/**
 * Milestone rules (ADR-0131, AI-302: M4.33). A milestone holds top-level epics; a child epic and
 * every ticket take the milestone of their top-level epic. Nothing reads these yet: the API and
 * MCP (AI-304: M4.34) and the dispatch rule (AI-306: M4.36) will. Which tickets may hold one:
 * `milestoneTargetProblem` in `@andy/contracts`, checked on every ticket write.
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

/** Highest `order` a milestone may hold (the contract's bound). */
const ORDER_MAX = 10_000;
/** Spacing between orders when a move renumbers, so later moves usually change one milestone. */
const ORDER_STEP = 10;

/**
 * The `order` writes that move milestone `id` to position `to` in `milestones` (given in roadmap
 * order) (AI-324). Usually one write: the moved milestone takes an order between its new
 * neighbours. When there is no room between them (equal or adjacent orders), every milestone
 * whose order changes is renumbered at steps of 10. A move to its own position writes nothing.
 */
export function milestoneReorder(
  milestones: readonly Pick<Milestone, "id" | "order">[],
  id: string,
  to: number,
): { id: string; order: number }[] {
  const from = milestones.findIndex((m) => m.id === id);
  if (from < 0) return [];
  const target = Math.max(0, Math.min(to, milestones.length - 1));
  if (target === from) return [];
  const rest = milestones.filter((m) => m.id !== id);
  const moved = milestones[from]!;
  const next = [...rest.slice(0, target), moved, ...rest.slice(target)];
  const before = next[target - 1];
  const after = next[target + 1];
  const low = before ? before.order : -1;
  const high = after ? after.order : ORDER_MAX + 1;
  if (high - low >= 2) {
    const order = !after
      ? Math.min(low + ORDER_STEP, high - 1)
      : !before
        ? Math.max(high - ORDER_STEP, low + 1)
        : Math.floor((low + high) / 2);
    return [{ id, order }];
  }
  return next.flatMap((m, i) =>
    m.order === i * ORDER_STEP ? [] : [{ id: m.id, order: i * ORDER_STEP }],
  );
}
