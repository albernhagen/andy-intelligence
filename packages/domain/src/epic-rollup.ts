import type { Run, Size, Stage, Ticket, TicketType } from "@andy/contracts";
import { ticketCost } from "./cost";
import { DomainError } from "./errors";

/**
 * An epic's children and roll-up (AI-85, workflow §4.4): computed on read (domain-and-ports
 * "Rollups"), never stored. Children and progress come from the project's ticket list, one read;
 * cost needs one runs read per child, capped (ADR-0028).
 */

/**
 * Children whose agent tasks are read for the cost roll-up, most likely spenders first
 * (`costOrder`); past it the cost is marked partial. Cancelled children are never read.
 */
export const MAX_EPIC_COST_READS = 50;

/** Stages where a blocker no longer blocks. */
const SETTLED: readonly Stage[] = ["done", "cancelled"];

export interface EpicChild {
  id: string;
  key: string;
  title: string;
  type: TicketType | null;
  stage: Stage;
  size: Size | null;
  /** Keys of blockers not yet Done or Cancelled; a blocker outside the project reads as its id. */
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
  const ids = new Set(ranked.map((t) => t.id));
  const placed = new Set<string>();
  const ordered: Ticket[] = [];
  let progressed = true;
  while (ordered.length < ranked.length && progressed) {
    progressed = false;
    for (const t of ranked) {
      if (placed.has(t.id)) continue;
      if (t.blockedBy.every((b) => !ids.has(b) || placed.has(b))) {
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

/** The epic's children, in dependency order, from the project's ticket list. */
export function epicChildren(epic: Ticket, tickets: readonly Ticket[]): EpicChild[] {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  return dependencyOrder(childrenOf(epic, tickets)).map((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    type: t.type,
    stage: t.stage,
    size: t.size,
    openBlockers: t.blockedBy
      .map((id) => byId.get(id) ?? id)
      .filter((b) => typeof b === "string" || !SETTLED.includes(b.stage))
      .map((b) => (typeof b === "string" ? b : b.key)),
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

/**
 * Reads an epic's roll-up: the ticket list the caller already has, plus one `runsOf` call for
 * each of at most `MAX_EPIC_COST_READS` children (`costOrder`). A ticket that isn't an epic is
 * refused.
 */
export async function readEpicRollup(
  epic: Ticket,
  tickets: readonly Ticket[],
  runsOf: RunsOfTicket,
): Promise<EpicRollup> {
  if (epic.type !== "epic") {
    throw new DomainError("invalid_reference", `${epic.key} is not an epic`);
  }
  const read = costOrder(childrenOf(epic, tickets)).slice(0, MAX_EPIC_COST_READS);
  const runs = await Promise.all(read.map((c) => runsOf(epic.projectId, c.id)));
  return epicRollup(epicChildren(epic, tickets), new Map(read.map((c, i) => [c.id, runs[i]!])));
}
