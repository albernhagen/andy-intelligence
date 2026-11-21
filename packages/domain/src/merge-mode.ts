import type { AutoMerge, MergeMode, Project } from "@andy/contracts";
import { DomainError } from "./errors";

/**
 * Merge modes (ADR-0124): one project setting decides who merges. This module holds the rules
 * on the setting itself; nothing reads the mode to merge yet (AI-215: the verdict and the gate).
 */

/** Strictest first: an earlier mode lets fewer PRs merge without Andy. */
export const MERGE_MODE_ORDER: readonly MergeMode[] = ["manual", "epic", "low-risk", "all-clean"];

/** What merges without Andy in each mode, one line each, for the settings page and MCP. */
export const MERGE_MODE_TEXT: Record<MergeMode, string> = {
  manual: "Nothing merges into the default branch without you.",
  epic: "A clean ticket in an epic merges into the epic's branch; you merge one PR per epic. Tickets with no epic wait for you.",
  "low-risk":
    "A clean PR merges unless its diff touches the high-risk list; the rest wait for you.",
  "all-clean":
    "A clean PR merges unless it is a kind you always merge (who merges, what judges a PR, anything needing your hands).",
};

/** ADR-0124's mapping from the old size policy, for projects stored before `mergeMode`. */
const FROM_AUTO_MERGE: Record<AutoMerge, MergeMode> = {
  none: "manual",
  s: "low-risk",
  "s-and-m": "low-risk",
  all: "all-clean",
};

/**
 * The project's mode: its stored `mergeMode`, else the mapping from `autoMerge`. Project AI is
 * the ADR's one exception: unset, it reads `all-clean`, the rule its coordinator applies today
 * (ADR-0120), not `manual`.
 */
export function effectiveMergeMode(
  project: Pick<Project, "id" | "mergeMode" | "autoMerge">,
): MergeMode {
  if (project.mergeMode) return project.mergeMode;
  if (project.id === "ai") return "all-clean";
  return FROM_AUTO_MERGE[project.autoMerge];
}

/** Whether `mode` lets more PRs merge without Andy than `than`. */
export function isLooser(mode: MergeMode, than: MergeMode): boolean {
  return MERGE_MODE_ORDER.indexOf(mode) > MERGE_MODE_ORDER.indexOf(than);
}

/**
 * Refuses a ticket or epic override looser than the project's mode (ADR-0124: an override may
 * only be stricter). Equal is allowed: it changes nothing.
 */
export function requireOverrideNotLooser(
  override: MergeMode | undefined,
  project: Pick<Project, "id" | "key" | "mergeMode" | "autoMerge">,
): void {
  if (!override) return;
  const projectMode = effectiveMergeMode(project);
  if (isLooser(override, projectMode)) {
    throw new DomainError(
      "invalid_field",
      `merge mode ${override} is looser than project ${project.key}'s ${projectMode}`,
      [
        `a ticket or epic may only be stricter: ${MERGE_MODE_ORDER.slice(0, MERGE_MODE_ORDER.indexOf(projectMode) + 1).join(", ")}`,
      ],
    );
  }
}

/** Refuses loosening over MCP (`set_merge_mode`, a settings revert): that is done in the app. */
export function requireTightening(
  next: MergeMode,
  project: Pick<Project, "id" | "key" | "mergeMode" | "autoMerge">,
): void {
  const current = effectiveMergeMode(project);
  if (isLooser(next, current)) {
    throw new DomainError(
      "invalid_field",
      `merge mode ${next} is looser than project ${project.key}'s ${current}`,
      ["over MCP a merge mode may only be tightened; loosen it on the project settings page"],
    );
  }
}
