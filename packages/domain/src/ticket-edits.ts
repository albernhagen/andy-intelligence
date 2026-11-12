import { TicketKey, compareRanks, type Ticket } from "@andy/contracts";
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

/**
 * Every ticket by key and by id. `blockedBy` holds keys of tickets in any project (key prefixes
 * are unique, AI-96); entries written before that hold ids of tickets in the same project.
 */
export function ticketsByRef(tickets: readonly Ticket[]): Map<string, Ticket> {
  return new Map(tickets.flatMap((t) => [[t.key, t] as const, [t.id, t] as const]));
}

/** The project a ticket key belongs to (its lowercased prefix), or null for an id. */
export function projectOfKey(ref: string): string | null {
  return TicketKey.safeParse(ref).success ? ref.slice(0, ref.lastIndexOf("-")).toLowerCase() : null;
}

/** Each entry as its ticket's key, without repeats; an entry that names no ticket stays as it is. */
export function blockerKeys(
  blockedBy: readonly string[],
  byRef: ReadonlyMap<string, Ticket>,
): string[] {
  return [...new Set(blockedBy.map((ref) => byRef.get(ref)?.key ?? ref))];
}

/**
 * Why these blockers can't be set on the ticket (one would end up blocking itself), or null.
 * `byRef` (see ticketsByRef) holds every ticket the chain can reach, in any project.
 */
export function blockerProblem(
  ticket: Ticket,
  blockedBy: readonly string[],
  byRef: ReadonlyMap<string, Ticket>,
): string | null {
  for (const ref of blockedBy) {
    if (ticket.blockedBy.includes(ref)) continue;
    const start = byRef.get(ref);
    if (!start) continue;
    if (start.id === ticket.id) return `${ticket.key} can't block itself`;
    const seen = new Set<string>();
    const pending = [start];
    while (pending.length > 0) {
      const next = pending.pop()!;
      if (next.id === ticket.id) return `${start.key} is already waiting on ${ticket.key}`;
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      for (const r of next.blockedBy) {
        const found = byRef.get(r);
        if (found) pending.push(found);
      }
    }
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
