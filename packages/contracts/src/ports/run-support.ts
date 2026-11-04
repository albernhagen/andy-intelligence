import { Run, type RunStatus } from "../entities";
import { NewRun, WorkTrackerError, type RunPatch } from "./index";

/**
 * Pure helpers shared by every RunStore adapter, so they build and change runs the same way.
 * Adapters own only storage and atomicity.
 */

export function buildRun(input: NewRun, id: string, now: Date): Run {
  const p = NewRun.parse(input);
  return Run.parse({
    ...p,
    id,
    status: "queued",
    startedAt: null,
    endedAt: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    costIsEstimate: false,
    quotaSnapshot: null,
    links: {},
    outcome: null,
    wouldAutoMerge: null,
    createdAt: now.toISOString(),
  });
}

/** The patched run, or `conflict` when its status isn't one of `from`. */
export function applyRunPatch(current: Run, patch: RunPatch, from: readonly RunStatus[]): Run {
  if (!from.includes(current.status)) {
    throw new WorkTrackerError(
      "conflict",
      `run ${current.id} is ${current.status}, expected ${from.join(" or ")}`,
    );
  }
  // Not RunPatch.parse: its defaulted fields would turn "absent" into null and wipe values.
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return Run.parse({ ...current, ...set });
}

/** Newest first, by creation time. */
export function newestFirst(a: Run, b: Run): number {
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}
