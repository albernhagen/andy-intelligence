import {
  NightLaunch,
  nightLaunchIsActive,
  type NightEndReason,
  type NightLaunchStatus,
  type NightStoppedStory,
} from "../entities/night";
import { WorkTrackerError } from "./index";

// ── NightLaunchStore ─────────────────────────────────────────────────────────
// Overnight launches (ADR-0049). Storage only: the readiness check lives in @andy/domain.
// Errors are WorkTrackerError (`not_found`, `conflict`), mapped the same way by the API.

/** A status change; the other fields are set only when given. */
export interface NightLaunchTransition {
  status: NightLaunchStatus;
  startedAt?: string;
  endedAt?: string;
  endReason?: NightEndReason;
}

export interface NightLaunchStore {
  /**
   * Stores the launch. Atomically refuses (`conflict`) an active launch (`running` or
   * `stopping`) while another is active in the same project, and a duplicate id.
   */
  create(launch: NightLaunch): Promise<NightLaunch>;
  get(launchId: string): Promise<NightLaunch | null>;
  /** Every launch in the project, newest first. */
  listForProject(projectId: string): Promise<NightLaunch[]>;
  /** The project's active launch, or null. */
  findActive(projectId: string): Promise<NightLaunch | null>;
  /**
   * Applies `change` atomically when the launch's status is one of `from`; otherwise
   * `conflict` and nothing is written. Making a launch active this way follows `create`'s rule.
   * `not_found` if unknown.
   */
  transition(
    launchId: string,
    from: readonly NightLaunchStatus[],
    change: NightLaunchTransition,
  ): Promise<NightLaunch>;
  /**
   * Appends a stopped story atomically while the launch is `running` or `stopping`; a story
   * already stopped keeps its first entry (a replay changes nothing). `conflict` once the launch
   * ended, `not_found` if unknown.
   */
  stopStory(launchId: string, story: NightStoppedStory): Promise<NightLaunch>;
}

/**
 * The launch with `story` appended (shared by every NightLaunchStore): `conflict` unless it is
 * running or stopping; a story already stopped is left as it was.
 */
export function withStoppedStory(launch: NightLaunch, story: NightStoppedStory): NightLaunch {
  if (!nightLaunchIsActive(launch)) {
    throw new WorkTrackerError("conflict", `night launch ${launch.id} is ${launch.status}`);
  }
  if (launch.stoppedStories.some((s) => s.key === story.key)) return launch;
  return NightLaunch.parse({ ...launch, stoppedStories: [...launch.stoppedStories, story] });
}
