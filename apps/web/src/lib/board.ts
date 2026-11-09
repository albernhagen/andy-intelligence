import { Stage, compareRanks, type Ticket } from "@andy/contracts";
import { openBlockers, rankBetween } from "@andy/domain";

export { openBlockers, runLabel } from "@andy/domain";

/**
 * Board v2 (AI-28) rules that need no React: what a drop does, the Ready queue, and the words
 * on a card's markers (apps/web/design.md "Status markers").
 */

/** Lanes that start as a narrow strip with a count; a click expands them. */
export const COLLAPSED_STAGES: readonly Stage[] = ["done"];

/** Where a dragged card lands and the rank that puts it there; `rank` null keeps its rank. */
export interface DropPlan {
  to: Stage;
  rank: string | null;
}

/**
 * What a drop means. `overId` is a card's id (land at that card's place) or a lane's stage
 * (land at the end of that lane). Dropping in place, or on its own lane's empty space, is
 * nothing. The new rank sits between the card's new neighbours (`rankBetween`).
 */
export function planDrop(
  lanes: Record<Stage, readonly Ticket[]>,
  ticket: Ticket,
  overId: string,
): DropPlan | null {
  const lane = Stage.safeParse(overId);
  const overCard = lane.success
    ? null
    : Object.values(lanes)
        .flat()
        .find((t) => t.id === overId);
  if (!lane.success && !overCard) return null;
  const to = lane.success ? lane.data : overCard!.stage;
  if (to === ticket.stage && (lane.success || overCard!.id === ticket.id)) return null;

  const order = lanes[to].filter((t) => t.id !== ticket.id);
  // In its own lane a card takes the place of the one it is dropped on (list reorder); in
  // another lane it goes above it.
  const index = overCard ? lanes[to].indexOf(overCard) : order.length;
  order.splice(index, 0, ticket);
  const before = order[index - 1]?.rank ?? null;
  const after = order[index + 1]?.rank ?? null;
  try {
    return { to, rank: rankBetween(before, after) };
  } catch {
    // A rank we can't place between (not made by rankFor or rankBetween): move without one.
    return { to, rank: null };
  }
}

/** Drop targets for the two parts of Backlog (ADR-0075). */
export const UP_NEXT_ZONE = "zone:up-next";
export const IDEAS_ZONE = "zone:ideas";

export function isBacklogZone(id: string): boolean {
  return id === UP_NEXT_ZONE || id === IDEAS_ZONE;
}

/** Backlog's two parts: Up next in its own order, then Ideas. */
export function splitBacklog<T extends Ticket>(backlog: readonly T[]): { upNext: T[]; ideas: T[] } {
  return {
    upNext: backlog
      .filter((t) => t.upNextRank !== null)
      .sort((a, b) => compareRanks(a.upNextRank!, b.upNextRank!)),
    ideas: backlog.filter((t) => t.upNextRank === null),
  };
}

/** What a drop means for Up next; `rank` null lets the API put it at the end. */
export interface UpNextPlan {
  upNext: boolean;
  rank: string | null;
}

/**
 * A drop on Backlog's parts: into or within Up next, or back out to Ideas. Null when Up next isn't
 * involved (reordering Ideas, or a drop elsewhere): the ordinary lane rules apply.
 */
export function planUpNextDrop(
  backlog: readonly Ticket[],
  ticket: Ticket,
  overId: string,
): UpNextPlan | null {
  const { upNext, ideas } = splitBacklog(backlog);
  const overUpNext = upNext.find((t) => t.id === overId);
  const wasUpNext = ticket.stage === "backlog" && ticket.upNextRank !== null;
  if (overId === IDEAS_ZONE || ideas.some((t) => t.id === overId)) {
    return wasUpNext ? { upNext: false, rank: null } : null;
  }
  if (overId !== UP_NEXT_ZONE && !overUpNext) return null;
  if (overUpNext?.id === ticket.id) return null;

  const order = upNext.filter((t) => t.id !== ticket.id);
  // A card already in Up next dropped on the header goes to the top; a new one joins the end.
  const index = overUpNext ? upNext.indexOf(overUpNext) : wasUpNext ? 0 : order.length;
  order.splice(index, 0, ticket);
  try {
    return {
      upNext: true,
      rank: rankBetween(order[index - 1]?.upNextRank ?? null, order[index + 1]?.upNextRank ?? null),
    };
  } catch {
    return { upNext: true, rank: null };
  }
}

/** The Ready card to build next: the highest-ranked one with no open blocker. */
export function nextUp(ready: readonly Ticket[], byId: ReadonlyMap<string, Ticket>): Ticket | null {
  return ready.find((t) => openBlockers(t, byId).length === 0) ?? null;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
