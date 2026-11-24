import type {
  EnvironmentPolicy,
  ExecutorKind,
  MergeMode,
  PlanApproval,
  ProjectSettings,
  Worker,
} from "@andy/contracts";
import { MERGE_MODE_TEXT } from "@andy/domain";
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

/** One choice of a picker: its plain name and one line on what it does (AI-372). */
export interface SettingOption {
  label: string;
  description: string;
}

/** Merge modes by plain name, strictest first, with what still waits for Andy (ADR-0124). */
export const MERGE_MODE_OPTIONS: Record<MergeMode, SettingOption & { youMerge: string }> = {
  manual: { label: "Manual", description: MERGE_MODE_TEXT.manual, youMerge: "every PR" },
  epic: {
    label: "Per epic",
    description: MERGE_MODE_TEXT.epic,
    youMerge: "one PR per epic, and tickets with no epic",
  },
  "low-risk": {
    label: "Low risk",
    description: MERGE_MODE_TEXT["low-risk"],
    youMerge: "high-risk PRs",
  },
  "all-clean": {
    label: "All clean",
    description: MERGE_MODE_TEXT["all-clean"],
    youMerge: "kept kinds only",
  },
};

export const PLAN_APPROVAL_OPTIONS: Record<PlanApproval, SettingOption> = {
  none: { label: "Never", description: "No ticket waits for a plan; builds start straight away." },
  "m-and-l": {
    label: "Medium and large",
    description: "M and L tickets wait for you to approve a plan; S tickets build at once.",
  },
  all: { label: "Every ticket", description: "Every ticket waits for you to approve its plan." },
};

export const WORKER_OPTIONS: Record<Worker, SettingOption> = {
  agent: { label: "Agent", description: "An agent builds the ticket." },
  me: { label: "Me", description: "You build it; it shows as yours." },
  ask: { label: "Ask each ticket", description: "Each ticket waits for you to pick who works it." },
};

export const EXECUTOR_OPTIONS: Record<ExecutorKind, SettingOption> = {
  actions: { label: "GitHub Actions", description: "Agent tasks run in GitHub Actions." },
  local: {
    label: "Local runner",
    description: "Agent tasks run on your local runner while it is present, else on Actions.",
  },
};

export const ENVIRONMENT_OPTIONS: Record<EnvironmentPolicy, SettingOption> = {
  "prod-only": { label: "Prod only", description: "Releases go to prod, with PR previews." },
  "dev-and-prod": {
    label: "Dev and prod",
    description: "Releases go to dev first, then a promote to prod.",
  },
};

/** Each picker setting's options, so the change log shows the same names as the page. */
const OPTION_LABELS: Partial<Record<keyof ProjectSettings, Record<string, SettingOption>>> = {
  mergeMode: MERGE_MODE_OPTIONS,
  planApproval: PLAN_APPROVAL_OPTIONS,
  defaultWorker: WORKER_OPTIONS,
  executor: EXECUTOR_OPTIONS,
  environments: ENVIRONMENT_OPTIONS,
};

/**
 * A setting's value for people: on/off, numbers with separators, "not set" for none, and a
 * picker's value by its option name ("low-risk" reads "Low risk") when `field` is given.
 */
export function settingValue(v: unknown, field?: string): string {
  if (v === true) return "on";
  if (v === false) return "off";
  if (v === null || v === undefined) return "not set";
  if (typeof v === "number") return count(v);
  if (typeof v === "string") {
    const options = field
      ? (OPTION_LABELS as Record<string, Record<string, SettingOption>>)[field]
      : undefined;
    return options?.[v]?.label ?? v;
  }
  return JSON.stringify(v);
}
