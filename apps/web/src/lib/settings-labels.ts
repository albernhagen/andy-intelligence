import type { ProjectSettings } from "@andy/contracts";
import { count } from "@/lib/format";

/**
 * Each project setting's name as the settings page shows it (AI-329). The change log uses the
 * same words, so "autoRefine: false → true" reads "Auto-refine: off → on".
 */
export const SETTING_LABELS: Record<keyof ProjectSettings, string> = {
  buildEnabled: "Builds",
  autoBuild: "Auto-build",
  planApproval: "Plan approval",
  autoRefine: "Auto-refine",
  dailyQuestionCap: "Questions per day",
  autoMerge: "Auto-merge",
  mergeMode: "Merge mode",
  runsAtOnce: "Agent tasks at once",
  paused: "Paused",
  defaultWorker: "Default worker",
  executor: "Default executor",
  emailNotifications: "Email notifications",
  environments: "Environments",
  spendCaps: "Spend caps",
};

/** A setting's name for people; an unknown field keeps its own name. */
export const settingLabel = (field: string) =>
  (SETTING_LABELS as Record<string, string>)[field] ?? field;

/** A setting's value for people: on/off, numbers with separators, "not set" for none. */
export function settingValue(v: unknown): string {
  if (v === true) return "on";
  if (v === false) return "off";
  if (v === null || v === undefined) return "not set";
  if (typeof v === "number") return count(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
