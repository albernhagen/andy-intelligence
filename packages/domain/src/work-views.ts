import type { BoardTicket, Ticket } from "@andy/contracts";

/**
 * Fixed work views (ADR-0108 decision 5, AI-187): presets in code that narrow a board to the
 * open tickets waiting on someone. Nothing is stored per user; there is no editor.
 */
export const WORK_VIEWS = ["needs-me", "mine", "agents", "blocked", "in-review"] as const;
export type WorkView = (typeof WORK_VIEWS)[number];

export const WORK_VIEW_LABELS: Record<WorkView, string> = {
  "needs-me": "Needs you",
  mine: "Mine",
  agents: "Agents",
  blocked: "Blocked",
  "in-review": "In review",
};

/** A view name from a URL; anything else (missing, unknown, wrong type) is null: all tickets. */
export function parseWorkView(value: unknown): WorkView | null {
  return typeof value === "string" && (WORK_VIEWS as readonly string[]).includes(value)
    ? (value as WorkView)
    : null;
}

/** Not Done, Cancelled or archived: only these are in any view. */
export const isOpenTicket = (t: Ticket) =>
  !t.archived && t.stage !== "done" && t.stage !== "cancelled";

/**
 * The views an open ticket is in (none for a closed one). `byId` holds the board's tickets, for
 * blockers: a blocker counts until it is Done (ADR-0108), so a Cancelled blocker keeps the ticket
 * in Blocked until someone removes it; the card's "Blocked by" marker ignores it.
 * Needs you matches the Needs-you inbox (an open question or the API's flag, AI-40) plus a
 * ticket whose worker is still to be picked (ADR-0082). An epic never runs, so it is never
 * Mine or Agents.
 */
export function workViews(ticket: BoardTicket, byId: ReadonlyMap<string, Ticket>): WorkView[] {
  if (!isOpenTicket(ticket)) return [];
  const { worker, openQuestions } = ticket.summary;
  const runs = ticket.type !== "epic";
  const views: WorkView[] = [];
  if (openQuestions > 0 || ticket.needsAttention || (runs && worker === "ask"))
    views.push("needs-me");
  if (runs && worker === "me") views.push("mine");
  if (runs && worker === "agent") views.push("agents");
  if (hasBlockerNotDone(ticket, byId)) views.push("blocked");
  if (ticket.stage === "ready_for_review") views.push("in-review");
  return views;
}

/** Entries are keys, or ids written before AI-96; a blocker in another project isn't on the board. */
function hasBlockerNotDone(ticket: Ticket, byId: ReadonlyMap<string, Ticket>): boolean {
  const find = (ref: string) => byId.get(ref) ?? [...byId.values()].find((t) => t.key === ref);
  return ticket.blockedBy.some((ref) => {
    const blocker = find(ref);
    return !!blocker && blocker.stage !== "done";
  });
}

/** Open tickets per view, for the chips' counts. */
export function workViewCounts(
  tickets: readonly BoardTicket[],
  byId: ReadonlyMap<string, Ticket>,
): Record<WorkView, number> {
  const counts = Object.fromEntries(WORK_VIEWS.map((v) => [v, 0])) as Record<WorkView, number>;
  for (const t of tickets) for (const v of workViews(t, byId)) counts[v]++;
  return counts;
}
