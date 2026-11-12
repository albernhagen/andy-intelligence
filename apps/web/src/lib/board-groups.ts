import type { Ticket } from "@andy/contracts";

/**
 * Board grouping by epic (AI-86: M4.2, ADR-0059: lanes stay one per stage). Inside a lane the
 * cards sit under one header per epic, "No epic" last. A ticket's epic is its parent when that
 * parent is an epic on this board. Grouping only changes the view: rank stays per lane.
 */

export interface EpicGroup<T extends Ticket> {
  /** Null for "No epic". */
  epic: Ticket | null;
  cards: T[];
}

/** The ticket's epic: its parent when the parent is an epic ticket; else null. */
export function epicOf(ticket: Ticket, byId: ReadonlyMap<string, Ticket>): Ticket | null {
  const parent = ticket.parentId ? byId.get(ticket.parentId) : undefined;
  return parent?.type === "epic" ? parent : null;
}

/** Key number, so AI-9 sorts before AI-10. */
const keyNumber = (t: Ticket) => Number(t.key.split("-").pop());

/** Epics on the board, in key order: the filter's choices and the order of group headers. */
export function boardEpics(tickets: readonly Ticket[]): Ticket[] {
  return tickets.filter((t) => t.type === "epic").sort((a, b) => keyNumber(a) - keyNumber(b));
}

/**
 * Splits a lane's cards (already in lane order) into groups, one per epic in key order, then
 * "No epic". Each group keeps the lane order; empty groups are left out.
 */
export function groupByEpic<T extends Ticket>(
  cards: readonly T[],
  byId: ReadonlyMap<string, Ticket>,
): EpicGroup<T>[] {
  const byEpic = new Map<string | null, EpicGroup<T>>();
  for (const card of cards) {
    const epic = epicOf(card, byId);
    const key = epic?.id ?? null;
    if (!byEpic.has(key)) byEpic.set(key, { epic, cards: [] });
    byEpic.get(key)!.cards.push(card);
  }
  return [...byEpic.values()].sort((a, b) =>
    a.epic === null ? 1 : b.epic === null ? -1 : keyNumber(a.epic) - keyNumber(b.epic),
  );
}

/** Done of total for an epic's children; cancelled children don't count. */
export function epicProgress(
  epicId: string,
  tickets: readonly Ticket[],
): { done: number; total: number } {
  const children = tickets.filter((t) => t.parentId === epicId && t.stage !== "cancelled");
  return { done: children.filter((t) => t.stage === "done").length, total: children.length };
}

/** Whether two cards sit under the same header. */
export function sameGroup(a: Ticket, b: Ticket, byId: ReadonlyMap<string, Ticket>): boolean {
  return (epicOf(a, byId)?.id ?? null) === (epicOf(b, byId)?.id ?? null);
}

/** The epic filter: every ticket, or only one epic's direct children. */
export function inEpic(ticket: Ticket, epicId: string | null): boolean {
  return epicId === null || ticket.parentId === epicId;
}

const STORAGE_KEY = "andy.board.groupByEpic";

/** The viewer's remembered choice; off when nothing (or storage) is there. */
export function loadGroupByEpic(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveGroupByEpic(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembering is fine; the toggle still works for this visit.
  }
}
