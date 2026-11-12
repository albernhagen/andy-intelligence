import type { Run, Size, Stage, Ticket, TicketType } from "@andy/contracts";
import { unfinishedBlockers } from "./builds";
import { ticketCost } from "./cost";
import { DomainError } from "./errors";
import { blockerKeys, projectOfKey, ticketsByRef } from "./ticket-edits";

/**
 * An epic's children and roll-up (AI-85, workflow §4.4): computed on read (domain-and-ports
 * "Rollups"), never stored. Children and progress come from the project's ticket list, one read;
 * blockers in other projects need one ticket-list read per project, and cost one runs read per
 * child, both capped (ADR-0028).
 */

/**
 * Children whose agent tasks are read for the cost roll-up, most likely spenders first
 * (`costOrder`); past it the cost is marked partial. Cancelled children are never read.
 */
export const MAX_EPIC_COST_READS = 50;

/** Other projects whose tickets are read to tell if a child's blocker is open; past it: open. */
export const MAX_EPIC_BLOCKER_PROJECTS = 5;

export interface EpicChild {
  id: string;
  key: string;
  title: string;
  type: TicketType | null;
  stage: Stage;
  size: Size | null;
  /** Keys of blockers not yet Done (`unfinishedBlockers`); one whose stage wasn't read is open. */
  openBlockers: string[];
}

export interface EpicRollup {
  /** Non-archived children, each after the children it is blocked by, then by rank. */
  children: EpicChild[];
  /** Done children of all children that aren't Cancelled. */
  progress: { done: number; total: number };
  /** Summed over the finished agent tasks of the `costedChildren` children read; Cancelled excluded. */
  cost: { estimatedCostUsd: number; completedRuns: number; unknownRuns: number };
  costedChildren: number;
  /** True when some non-cancelled children weren't read (over `MAX_EPIC_COST_READS`). */
  partial: boolean;
}

const byRank = (a: Ticket, b: Ticket) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);

/**
 * Children so each comes after the siblings it is blocked by; otherwise rank order. A cycle
 * can't be ordered: its tickets follow in rank order.
 */
export function dependencyOrder(children: readonly Ticket[]): Ticket[] {
  const ranked = [...children].sort(byRank);
  const sibling = ticketsByRef(ranked);
  // `blockedBy` holds keys (AI-96), or ids written before; both name the sibling's id here.
  const blockers = new Map(
    ranked.map((t) => [t.id, t.blockedBy.flatMap((ref) => sibling.get(ref)?.id ?? [])]),
  );
  const placed = new Set<string>();
  const ordered: Ticket[] = [];
  let progressed = true;
  while (ordered.length < ranked.length && progressed) {
    progressed = false;
    for (const t of ranked) {
      if (placed.has(t.id)) continue;
      if (blockers.get(t.id)!.every((b) => placed.has(b))) {
        ordered.push(t);
        placed.add(t.id);
        progressed = true;
        // Restart so a ticket just unblocked keeps its rank place over later ones.
        break;
      }
    }
  }
  return [...ordered, ...ranked.filter((t) => !placed.has(t.id))];
}

/** The epic's non-archived children. */
const childrenOf = (epic: Ticket, tickets: readonly Ticket[]) =>
  tickets.filter((t) => t.parentId === epic.id && !t.archived);

/**
 * The epic's children, in dependency order, from the project's ticket list and any other
 * projects' tickets read for their blockers.
 */
export function epicChildren(epic: Ticket, tickets: readonly Ticket[]): EpicChild[] {
  const byRef = ticketsByRef(tickets);
  const stages = new Map([...byRef].map(([ref, t]) => [ref, t.stage]));
  return dependencyOrder(childrenOf(epic, tickets)).map((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    type: t.type,
    stage: t.stage,
    size: t.size,
    openBlockers: blockerKeys(unfinishedBlockers(t, stages), byRef),
  }));
}

/** Where agent tasks are likeliest: past Backlog, then Up next, then Ideas (no agent spend). */
const spendTier = (t: Ticket) => (t.stage !== "backlog" ? 0 : t.upNextRank !== null ? 1 : 2);

/**
 * The non-cancelled children in the order their agent tasks are read for cost: likeliest
 * spenders first (`spendTier`), then dependency order. Cancelled children are left out.
 */
export function costOrder(children: readonly Ticket[]): Ticket[] {
  const open = dependencyOrder(children).filter((t) => t.stage !== "cancelled");
  return open
    .map((t, i) => ({ t, i }))
    .sort((a, b) => spendTier(a.t) - spendTier(b.t) || a.i - b.i)
    .map(({ t }) => t);
}

/** Progress and cost from the children and the agent tasks read for some of them. */
export function epicRollup(
  children: readonly EpicChild[],
  runsByChild: ReadonlyMap<string, readonly Run[]>,
): EpicRollup {
  const counted = children.filter((c) => c.stage !== "cancelled");
  const cost = ticketCost([...runsByChild.values()].flat());
  return {
    children: [...children],
    progress: { done: counted.filter((c) => c.stage === "done").length, total: counted.length },
    cost: {
      estimatedCostUsd: cost.estimatedCostUsd,
      completedRuns: cost.completedRuns,
      unknownRuns: cost.unknownRuns,
    },
    costedChildren: runsByChild.size,
    partial: runsByChild.size < counted.length,
  };
}

/** Lists a ticket's runs; REST passes the run store, MCP the run service. */
export type RunsOfTicket = (projectId: string, ticketId: string) => Promise<readonly Run[]>;
/** Lists a project's tickets; empty for an unknown project. */
export type TicketsOfProject = (projectId: string) => Promise<readonly Ticket[]>;

/** The other projects the children's blockers name, at most `MAX_EPIC_BLOCKER_PROJECTS`. */
function blockerProjects(epic: Ticket, children: readonly Ticket[]): string[] {
  const named = children.flatMap((t) => t.blockedBy.map(projectOfKey));
  const other = new Set(named.filter((p): p is string => p !== null && p !== epic.projectId));
  return [...other].sort().slice(0, MAX_EPIC_BLOCKER_PROJECTS);
}

/**
 * Reads an epic's roll-up: the ticket list the caller already has, one `ticketsOf` call for each
 * other project a blocker names (at most `MAX_EPIC_BLOCKER_PROJECTS`), and one `runsOf` call for
 * each of at most `MAX_EPIC_COST_READS` children (`costOrder`). A ticket that isn't an epic is
 * refused.
 */
export async function readEpicRollup(
  epic: Ticket,
  tickets: readonly Ticket[],
  runsOf: RunsOfTicket,
  ticketsOf: TicketsOfProject,
): Promise<EpicRollup> {
  if (epic.type !== "epic") {
    throw new DomainError("invalid_reference", `${epic.key} is not an epic`);
  }
  const children = childrenOf(epic, tickets);
  const read = costOrder(children).slice(0, MAX_EPIC_COST_READS);
  const [others, runs] = await Promise.all([
    Promise.all(blockerProjects(epic, children).map((p) => ticketsOf(p))),
    Promise.all(read.map((c) => runsOf(epic.projectId, c.id))),
  ]);
  return epicRollup(
    epicChildren(epic, [...tickets, ...others.flat()]),
    new Map(read.map((c, i) => [c.id, runs[i]!])),
  );
}
