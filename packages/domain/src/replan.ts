import type { Run, Stage, Ticket, TicketEvent, WorkTracker } from "@andy/contracts";
import { planWrittenAt, type PlanState } from "./plans";

/**
 * Just-in-time re-planning (M4.6, `workflow.md` §4.4): a plan written before one of the ticket's
 * `blockedBy` tickets reached Done is stale, so the dispatcher re-runs the plan step before the
 * build. Staleness comes from ticket events (`stage_changed` to `done`); nothing new is stored.
 */

/** When the ticket last moved to Done, from its events (oldest first); null if it never did. */
export function doneAt(events: readonly TicketEvent[]): string | null {
  let at: string | null = null;
  for (const e of events) {
    if (e.kind === "stage_changed" && (e.data.to as Stage | undefined) === "done") at = e.createdAt;
  }
  return at;
}

/**
 * The plan run that wrote a plan which can be outdated (approved, awaiting or otherwise stale);
 * null for none, planning or rejected (Andy re-plans a rejection).
 */
export function writtenPlan(plan: PlanState): Run | null {
  return plan.kind === "approved" || plan.kind === "awaiting" || plan.kind === "stale"
    ? plan.run
    : null;
}

/**
 * The blocker that reached Done after the plan was written (the latest one if several), or null.
 * `blockersDoneAt`: each `blockedBy` entry's last Done time, null when unknown. Only a
 * `writtenPlan` can be outdated.
 */
export function staleBlocker(
  plan: PlanState,
  blockersDoneAt: ReadonlyMap<string, string | null>,
): string | null {
  const run = writtenPlan(plan);
  if (!run) return null;
  const written = planWrittenAt(run);
  let stale: { key: string; at: number } | null = null;
  for (const [key, at] of blockersDoneAt) {
    const done = at === null ? NaN : Date.parse(at);
    if (done > written && (!stale || done > stale.at)) stale = { key, at: done };
  }
  return stale?.key ?? null;
}

/** The timeline line for a plan re-run (the ticket's own wording). */
export function replanNote(blockerKey: string): string {
  return `Plan re-run: ${blockerKey} merged after the plan.`;
}

/**
 * Each `blockedBy` entry's last Done time, keyed by the ticket's key. An entry names a ticket by
 * key (`AI-1`, possibly another project's) or by id, as `RunService.blockerStages` reads them.
 * An entry that names no ticket is left out.
 */
export async function blockersDoneAt(
  tracker: WorkTracker,
  ticket: Pick<Ticket, "projectId" | "blockedBy">,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (ticket.blockedBy.length === 0) return out;
  const projects = new Set([
    ticket.projectId,
    ...ticket.blockedBy
      .filter((b) => b.includes("-"))
      .map((b) => b.slice(0, b.lastIndexOf("-")).toLowerCase()),
  ]);
  const wanted = new Set(ticket.blockedBy);
  for (const projectId of projects) {
    for (const t of await tracker.listTickets(projectId).catch(() => [])) {
      if (!wanted.has(t.key) && !wanted.has(t.id)) continue;
      if (out.has(t.key)) continue;
      out.set(t.key, doneAt(await tracker.listEvents(t.projectId, t.id)));
    }
  }
  return out;
}
