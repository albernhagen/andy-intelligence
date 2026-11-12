import type { NightEndReason, NightLaunch, Run } from "@andy/contracts";
import { wasDispatched } from "./dispatch-caps";

/**
 * Night budget (ADR-0049 "Night budget", ADR-0028, M4.18). Pure: `BuildDispatcher` gathers the
 * launch's runs. Reached means no new agent tasks for the launch's stories; in-flight ones
 * finish, then the launch ends with the reason. The pause, the dispatch caps and the kill switch
 * are checked before this and keep precedence: this can only hold a story back, never start one.
 */

/** A limit that stops a launch from starting more agent tasks. */
export type NightLimit = Extract<
  NightEndReason,
  "stop_time" | "max_runs" | "max_tokens" | "max_usd"
>;

/** What a launch's agent tasks have used so far. */
export interface NightUsage {
  /** Agent tasks started for its stories since the launch began, finished or not. */
  runs: number;
  /** Input plus output tokens reported by those tasks. */
  tokens: number;
  /** Their estimated API-equivalent cost; a task with unknown cost adds nothing. */
  usd: number;
}

type CountedRun = Pick<Run, "createdAt" | "status" | "executor" | "localRun">;

/**
 * Whether a story's run counts against its launch: created since the launch started (a run with
 * no creation time counts, so a missing field can only hold dispatch back), and queued, running
 * or dispatched. A start that lost a race is failed before dispatch and doesn't count.
 */
export function countsForNight(launch: Pick<NightLaunch, "startedAt">, run: CountedRun): boolean {
  const since = launch.startedAt ? Date.parse(launch.startedAt) : -Infinity;
  if (run.createdAt && Date.parse(run.createdAt) < since) return false;
  return run.status === "queued" || run.status === "running" || wasDispatched(run);
}

/** What the launch's counted runs (`runs`: its stories' runs) have used. */
export function nightUsage(
  launch: Pick<NightLaunch, "startedAt">,
  runs: readonly (CountedRun & Pick<Run, "tokensIn" | "tokensOut" | "costUsd">)[],
): NightUsage {
  const mine = runs.filter((r) => countsForNight(launch, r));
  return {
    runs: mine.length,
    tokens: mine.reduce((n, r) => n + (r.tokensIn ?? 0) + (r.tokensOut ?? 0), 0),
    usd: mine.reduce((n, r) => n + (r.costUsd ?? 0), 0),
  };
}

/** The first limit the launch has reached, or null while it may start more agent tasks. */
export function nightLimitReached(
  launch: Pick<NightLaunch, "budget" | "stopAt">,
  usage: NightUsage,
  now: Date,
): NightLimit | null {
  if (now.getTime() >= Date.parse(launch.stopAt)) return "stop_time";
  if (usage.runs >= launch.budget.maxRuns) return "max_runs";
  if (usage.tokens >= launch.budget.maxTokens) return "max_tokens";
  if (usage.usd >= launch.budget.maxUsd) return "max_usd";
  return null;
}

/**
 * What `RunService.start` needs to keep concurrent starts under a launch's max agent tasks:
 * after creating its run it re-reads the stories' runs, and the run wins only if it is among
 * the first `maxRuns` counted ones (oldest first), like the dispatch caps (ADR-0079).
 */
export interface NightSlot {
  launch: Pick<NightLaunch, "id" | "startedAt" | "budget">;
  /** The launch's story tickets. */
  ticketIds: readonly string[];
}

/** Whether `runId` is among the first `maxRuns` counted runs of the launch, oldest first. */
export function winsNightSlot(
  slot: NightSlot,
  runs: readonly (CountedRun & Pick<Run, "id">)[],
  runId: string,
): boolean {
  const counted = runs
    .filter((r) => countsForNight(slot.launch, r))
    .sort(
      (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id),
    );
  const at = counted.findIndex((r) => r.id === runId);
  return at !== -1 && at < slot.launch.budget.maxRuns;
}

/**
 * Why a launch with nothing in flight ends now, or null while it goes on: the limit it reached;
 * `stopped` when Andy stopped it; `done` when every story is finished.
 */
export function nightEndReason(
  launch: Pick<NightLaunch, "status">,
  limit: NightLimit | null,
  allStoriesFinished: boolean,
): NightEndReason | null {
  if (limit) return limit;
  if (launch.status === "stopping") return "stopped";
  if (allStoriesFinished) return "done";
  return null;
}

/** The end reason in words, for the comment on each story the launch didn't finish. */
export const NIGHT_END_TEXT: Record<NightEndReason, string> = {
  done: "every story finished",
  stopped: "Andy stopped it",
  stop_time: "its stop time passed",
  max_runs: "it reached its max agent tasks",
  max_tokens: "it reached its max tokens",
  max_usd: "it reached its max USD",
};
