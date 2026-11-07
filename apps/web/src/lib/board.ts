import { Stage, type BoardTicket, type RunStep, type Ticket } from "@andy/contracts";
import { rankBetween } from "@andy/domain";

/**
 * Board v2 (AI-28) rules that need no React: what a drop does, the Ready queue, and the words
 * on a card's markers (apps/web/design.md "Status markers").
 */

/** Lanes that start as a narrow strip with a count; a click expands them. */
export const COLLAPSED_STAGES: readonly Stage[] = ["monitoring", "done"];

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

/** Blockers that are not finished yet (Done or Cancelled), as tickets on this board. */
export function openBlockers(ticket: Ticket, byId: ReadonlyMap<string, Ticket>): Ticket[] {
  return ticket.blockedBy
    .map((id) => byId.get(id))
    .filter((t): t is Ticket => !!t && t.stage !== "done" && t.stage !== "cancelled");
}

/** The Ready card to build next: the highest-ranked one with no open blocker. */
export function nextUp(ready: readonly Ticket[], byId: ReadonlyMap<string, Ticket>): Ticket | null {
  return ready.find((t) => openBlockers(t, byId).length === 0) ?? null;
}

const RUN_VERBS: Record<RunStep, string> = {
  refine: "Refining",
  plan: "Planning",
  build: "Building",
  review: "Reviewing",
  verify: "Verifying",
  scout: "Scouting",
};

/** "Refining · 3 min" while running; "Refine queued · 1 min" before it starts. */
export function runLabel(run: NonNullable<BoardTicket["summary"]["run"]>, now: number): string {
  const since = run.startedAt ?? run.createdAt;
  const min = since ? Math.max(0, Math.floor((now - Date.parse(since)) / 60_000)) : null;
  const what =
    run.status === "queued"
      ? `${run.step[0]!.toUpperCase()}${run.step.slice(1)} queued`
      : RUN_VERBS[run.step];
  return min === null ? what : `${what} · ${min} min`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
