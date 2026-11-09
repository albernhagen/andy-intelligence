import { compareRanks, type Ticket } from "@andy/contracts";
import { rankBetween } from "./ranks";

/** Where a reordered ticket goes: directly above or below another ticket's key. */
export type ReorderAnchor = { above: string } | { below: string };

/** Why `parentId` can't be this ticket's parent, or null when it can. */
export function parentProblem(
  ticket: Ticket,
  parentId: string,
  tickets: readonly Ticket[],
): string | null {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const parent = byId.get(parentId);
  if (!parent) return "the parent is not in this project";
  if (parent.type !== "epic") return `${parent.key} is not an epic`;
  if (parent.id === ticket.id) return `${ticket.key} can't be its own parent`;
  const seen = new Set<string>();
  for (let t: Ticket | undefined = parent; t && !seen.has(t.id); t = byId.get(t.parentId ?? "")) {
    if (t.id === ticket.id) return `${parent.key} is already under ${ticket.key}`;
    seen.add(t.id);
  }
  return null;
}

type Lane = "up_next" | "ideas" | "stage";

const laneOf = (t: Ticket): Lane =>
  t.stage !== "backlog" ? "stage" : t.upNextRank !== null ? "up_next" : "ideas";

/** The new rank that places `ticket` next to the anchor, or why it can't go there. */
export function reorderRank(
  ticket: Ticket,
  anchor: ReorderAnchor,
  tickets: readonly Ticket[],
): { lane: Lane; rank: string } | string {
  const key = "above" in anchor ? anchor.above : anchor.below;
  if (key === ticket.key) return `${ticket.key} can't move next to itself`;
  if (ticket.archived) return `${ticket.key} is archived`;
  const target = tickets.find((t) => t.key === key);
  if (!target) return `${key} is not in this project`;
  const lane = laneOf(ticket);
  if (target.archived || target.stage !== ticket.stage || laneOf(target) !== lane) {
    return `${key} is not in ${ticket.key}'s lane`;
  }

  const rankOf = (t: Ticket) => (lane === "up_next" ? t.upNextRank! : t.rank);
  const order = tickets
    .filter((t) => !t.archived && t.stage === ticket.stage && laneOf(t) === lane)
    .filter((t) => t.id !== ticket.id)
    .sort((a, b) => compareRanks(rankOf(a), rankOf(b)));
  const at = order.findIndex((t) => t.id === target.id) + ("above" in anchor ? 0 : 1);
  const before = order[at - 1];
  const after = order[at];
  try {
    return {
      lane,
      rank: rankBetween(before ? rankOf(before) : null, after ? rankOf(after) : null),
    };
  } catch {
    return `no rank fits next to ${key}`;
  }
}
