import type { NightEndReason, NightLaunch, Run } from "@andy/contracts";

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

/**
 * The usage of `runs` (the stories' runs) that belongs to the launch: those created since it
 * started. A run with no creation time counts, so a missing field can only hold dispatch back.
 */
export function nightUsage(
  launch: Pick<NightLaunch, "startedAt">,
  runs: readonly Pick<Run, "createdAt" | "tokensIn" | "tokensOut" | "costUsd">[],
): NightUsage {
  const since = launch.startedAt ? Date.parse(launch.startedAt) : -Infinity;
  const mine = runs.filter((r) => !r.createdAt || Date.parse(r.createdAt) >= since);
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
