import { byMilestoneOrder, type Milestone, type Ticket } from "@andy/contracts";
import { milestoneOf } from "@andy/domain";
import { epicOf, type EpicGroup } from "@/lib/board-groups";

/**
 * Ideas grouped by milestone, then epic (AI-400). Backlog's Ideas part is the long, unordered
 * list; it always shows one header per milestone (roadmap order, "No milestone" last), and under
 * each one header per epic ("No epic" last). Groups only change the view: rank stays per lane.
 * Which groups are open is a per-viewer choice kept in the browser; a parked milestone's group
 * starts collapsed. An open epic group shows its first `IDEAS_SHOWN` cards and a "Show all".
 */

/** Cards an open epic group shows before "Show all N". */
export const IDEAS_SHOWN = 10;

export interface IdeaGroup<T extends Ticket> {
  /** Stable id for collapse state: the milestone's id, or "none". */
  key: string;
  /** Null for "No milestone" (no epic, an epic without one, or a milestone not on the list). */
  milestone: Milestone | null;
  count: number;
  epics: (EpicGroup<T> & { key: string })[];
}

/** One row of the Ideas list, in the order shown. */
export type IdeaRow<T extends Ticket> =
  | { kind: "milestone"; group: IdeaGroup<T>; open: boolean }
  | { kind: "epic"; group: IdeaGroup<T>["epics"][number]; open: boolean }
  | { kind: "card"; card: T }
  | { kind: "more"; key: string; total: number };

/** The epic a card is grouped under on Ideas: its epic, or itself when it is a top-level epic. */
function ideaEpicOf(card: Ticket, byId: ReadonlyMap<string, Ticket>): Ticket | null {
  return epicOf(card, byId) ?? (card.type === "epic" ? card : null);
}

const keyNumber = (t: Ticket) => Number(t.key.split("-").pop());

/** One group per epic in key order, then "No epic"; each keeps the lane order. */
function byEpic<T extends Ticket>(
  cards: readonly T[],
  byId: ReadonlyMap<string, Ticket>,
): EpicGroup<T>[] {
  const groups = new Map<string | null, EpicGroup<T>>();
  for (const card of cards) {
    const epic = ideaEpicOf(card, byId);
    const key = epic?.id ?? null;
    if (!groups.has(key)) groups.set(key, { epic, cards: [] });
    groups.get(key)!.cards.push(card);
  }
  return [...groups.values()].sort((a, b) =>
    a.epic === null ? 1 : b.epic === null ? -1 : keyNumber(a.epic) - keyNumber(b.epic),
  );
}

/** The milestone a card's group sits under, or null. */
function milestoneFor(
  card: Ticket,
  all: readonly Ticket[],
  byMilestone: ReadonlyMap<string, Milestone>,
): Milestone | null {
  const id = milestoneOf(card, all);
  return id ? (byMilestone.get(id) ?? null) : null;
}

/**
 * Splits Ideas (already in lane order) into milestone groups, each split by epic. Empty groups
 * are left out; each group keeps the lane order.
 */
export function groupIdeas<T extends Ticket>(
  cards: readonly T[],
  all: readonly Ticket[],
  milestones: readonly Milestone[],
): IdeaGroup<T>[] {
  const byMilestone = new Map(milestones.map((m) => [m.id, m]));
  const byId = new Map(all.map((t) => [t.id, t]));
  const buckets = new Map<string, { milestone: Milestone | null; cards: T[] }>();
  for (const card of cards) {
    const milestone = milestoneFor(card, all, byMilestone);
    const key = milestone?.id ?? "none";
    if (!buckets.has(key)) buckets.set(key, { milestone, cards: [] });
    buckets.get(key)!.cards.push(card);
  }
  return [...buckets.entries()]
    .sort(([, a], [, b]) =>
      a.milestone === null
        ? 1
        : b.milestone === null
          ? -1
          : byMilestoneOrder(a.milestone, b.milestone),
    )
    .map(([key, { milestone, cards: inGroup }]) => ({
      key,
      milestone,
      count: inGroup.length,
      epics: byEpic(inGroup, byId).map((g) => ({
        ...g,
        key: `${key}/${g.epic?.id ?? "none"}`,
      })),
    }));
}

/** The group a card sits in on Ideas: drops between groups don't reorder (as with epics). */
export function ideaGroupKey(
  card: Ticket,
  all: readonly Ticket[],
  milestones: readonly Milestone[],
): string {
  const milestone = milestoneFor(card, all, new Map(milestones.map((m) => [m.id, m])));
  const epic = ideaEpicOf(card, new Map(all.map((t) => [t.id, t])));
  return `${milestone?.id ?? "none"}/${epic?.id ?? "none"}`;
}

/**
 * The rows Ideas shows: headers, then the cards of open groups (the first `IDEAS_SHOWN` unless
 * the group was shown in full), then "Show all" where cards are left out. `filtering` opens every
 * group, so a match is never hidden behind a collapsed header. Ideas with no milestone and no
 * epic at all show no headers.
 */
export function ideaRows<T extends Ticket>(
  groups: readonly IdeaGroup<T>[],
  view: {
    isCollapsed: (key: string, byDefault: boolean) => boolean;
    shownInFull: ReadonlySet<string>;
    filtering: boolean;
  },
): IdeaRow<T>[] {
  // Nothing to group by (no milestone, no epic): the plain list, still capped.
  const bare =
    groups.length === 1 && groups[0]!.milestone === null && groups[0]!.epics[0]?.epic === null;
  if (bare) return cardRows(groups[0]!.epics[0]!, view.shownInFull);
  const rows: IdeaRow<T>[] = [];
  for (const group of groups) {
    const open =
      view.filtering || !view.isCollapsed(group.key, group.milestone?.status === "parked");
    rows.push({ kind: "milestone", group, open });
    if (!open) continue;
    for (const epic of group.epics) {
      const epicOpen = view.filtering || !view.isCollapsed(epic.key, false);
      rows.push({ kind: "epic", group: epic, open: epicOpen });
      if (epicOpen) rows.push(...cardRows(epic, view.shownInFull));
    }
  }
  return rows;
}

/** An open epic group's cards: the first `IDEAS_SHOWN`, then "Show all", unless shown in full. */
function cardRows<T extends Ticket>(
  epic: IdeaGroup<T>["epics"][number],
  shownInFull: ReadonlySet<string>,
): IdeaRow<T>[] {
  const full = shownInFull.has(epic.key) || epic.cards.length <= IDEAS_SHOWN;
  const cards: IdeaRow<T>[] = (full ? epic.cards : epic.cards.slice(0, IDEAS_SHOWN)).map(
    (card) => ({ kind: "card", card }),
  );
  return full ? cards : [...cards, { kind: "more", key: epic.key, total: epic.cards.length }];
}

const STORAGE_KEY = "andy.board.ideaGroups";

/** Collapse choices per project: group key → collapsed. Missing means its default. */
type Choices = Record<string, Record<string, boolean>>;

function readChoices(): Choices {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Choices) : {};
  } catch {
    return {};
  }
}

/** The viewer's remembered collapse choices for one project's Ideas; none when storage fails. */
export function loadIdeaCollapse(projectId: string): Record<string, boolean> {
  const forProject = readChoices()[projectId];
  return forProject && typeof forProject === "object" ? forProject : {};
}

export function saveIdeaCollapse(projectId: string, choices: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readChoices(), [projectId]: choices }),
    );
  } catch {
    // Not remembering is fine; the toggle still works for this visit.
  }
}
