import {
  ACTIVE_RUN_STATUSES,
  WorkTrackerError,
  type NightEndReason,
  type NightLaunch,
  type NightLaunchStore,
  type RunStore,
  type WorkTracker,
} from "@andy/contracts";
import type { NightLaunches } from "./night-launch";

/**
 * Ending a night launch (ADR-0049): the one place a launch ends on its own. Without it a stopped
 * or expired launch would stay active and refuse every later launch in the project (one active
 * launch per project). The night routes and tools call it before every read, launch and stop;
 * the dispatcher can call it with a budget limit (M4.18).
 */

export interface NightEndDeps {
  nights: Pick<NightLaunches, "end">;
  store: Pick<NightLaunchStore, "findActive">;
  tracker: Pick<WorkTracker, "listTickets">;
  runs: Pick<RunStore, "listForTicket">;
  now?: () => Date;
}

/**
 * Why the active launch should end now, or null: `reason` when the caller gives one (a budget
 * limit it measured), else past its stop time (`stop_time`), else stopping with no agent task in
 * flight on its stories (`stopped`). A running launch with work left keeps running.
 */
export async function nightEndReason(
  deps: NightEndDeps,
  launch: NightLaunch,
  reason?: NightEndReason,
): Promise<NightEndReason | null> {
  if (reason) return reason;
  const now = (deps.now ?? (() => new Date()))();
  if (Date.parse(launch.stopAt) <= now.getTime()) return "stop_time";
  if (launch.status === "stopping" && !(await anyInFlight(deps, launch))) return "stopped";
  return null;
}

/**
 * Ends the project's active launch when `nightEndReason` says so; returns the launch still
 * active, or null. Losing a race to another end (`conflict`) is fine: the launch ended either way.
 */
export async function settleNight(
  deps: NightEndDeps,
  projectId: string,
  reason?: NightEndReason,
): Promise<NightLaunch | null> {
  const active = await deps.store.findActive(projectId);
  if (!active) return null;
  const end = await nightEndReason(deps, active, reason);
  if (!end) return active;
  try {
    await deps.nights.end(active.id, end);
  } catch (err) {
    if (!(err instanceof WorkTrackerError && err.code === "conflict")) throw err;
  }
  return null;
}

/** Whether any of the launch's stories has an agent task queued or running. */
async function anyInFlight(
  deps: Pick<NightEndDeps, "tracker" | "runs">,
  launch: NightLaunch,
): Promise<boolean> {
  const keys = new Set(launch.storyKeys);
  for (const t of await deps.tracker.listTickets(launch.projectId)) {
    if (!keys.has(t.key)) continue;
    const runs = await deps.runs.listForTicket(t.projectId, t.id);
    if (runs.some((r) => ACTIVE_RUN_STATUSES.includes(r.status))) return true;
  }
  return false;
}
