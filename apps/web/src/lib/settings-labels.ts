import type {
  DeployKind,
  EnvironmentPolicy,
  ExecutorKind,
  HarnessKey,
  MergeMode,
  PlanApproval,
  ProjectSettings,
  ProviderKey,
  RunStep,
  TierKey,
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
  deployKind: "Deploy kind",
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

/** How a project ships (ADR-0114); not a Deployment record's kind (deploy, promote, rollback). */
export const DEPLOY_KIND_OPTIONS: Record<DeployKind, SettingOption> = {
  none: { label: "No deploys", description: "This project does not deploy; only PRs and merges." },
  "cloud-run": {
    label: "Cloud Run",
    description: "Releases ship to Cloud Run on GCP, to the environments below.",
  },
};

/** Each picker setting's options, so the change log shows the same names as the page. */
const OPTION_LABELS: Partial<Record<keyof ProjectSettings, Record<string, SettingOption>>> = {
  mergeMode: MERGE_MODE_OPTIONS,
  planApproval: PLAN_APPROVAL_OPTIONS,
  defaultWorker: WORKER_OPTIONS,
  executor: EXECUTOR_OPTIONS,
  environments: ENVIRONMENT_OPTIONS,
  deployKind: DEPLOY_KIND_OPTIONS,
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

/** A routing option's plain name and what it is for (AI-376: Models), keyed by its id. */
export interface RoutingLabel {
  name: string;
  description: string;
}

/** Tiers: what each is for. Sizes map S → Fast, M and L → Strong (`TIER_FOR_SIZE`). */
export const TIER_LABELS: Record<TierKey, RoutingLabel> = {
  frontier: {
    name: "Frontier",
    description: "The most capable model, for work a step or ticket pins here.",
  },
  strong: {
    name: "Strong",
    description: "Medium and large tickets, project plans and ideate.",
  },
  fast: {
    name: "Fast",
    description: "Small tickets, refine, review, verify, scout and summaries.",
  },
  cheap: {
    name: "Cheap",
    description: "The lowest cost, for steps you move here.",
  },
};

/** Steps: what each agent task does. */
export const STEP_LABELS: Record<RunStep, RoutingLabel> = {
  refine: { name: "Refine", description: "Turns an idea into a ready ticket" },
  plan: { name: "Plan", description: "Writes a read-only plan before a build" },
  build: { name: "Build", description: "Writes the code and opens the PR" },
  review: { name: "Review", description: "Adversarial and security review of a PR" },
  verify: { name: "Verify", description: "Checks a merged change does what the ticket asked" },
  scout: { name: "Scout", description: "Reads the repo for context before other steps" },
  sync: { name: "Sync", description: "Merges the default branch into an agent's PR" },
  "plan-project": { name: "Plan project", description: "Turns a brief into milestones and epics" },
  ideate: { name: "Ideate", description: "Suggests new tickets for a project" },
  summarize: { name: "Summarize", description: "Writes the digest's summary" },
};

/** Providers: who serves the model and how it is paid for. */
export const PROVIDER_LABELS: Record<ProviderKey, RoutingLabel & { paid: boolean }> = {
  "claude-sub": {
    name: "Claude subscription",
    description: "Claude through your plan; held by quota levels",
    paid: false,
  },
  "google-sub": {
    name: "Google subscription",
    description: "Gemini through your plan; held by quota and a daily task limit",
    paid: false,
  },
  openrouter: {
    name: "OpenRouter",
    description: "Many models, paid per use; counts against spend caps",
    paid: true,
  },
  "claude-api": {
    name: "Claude API",
    description: "Claude through an API key, paid per use; counts against spend caps",
    paid: true,
  },
};

/** Harnesses: the program that runs the model. */
export const HARNESS_LABELS: Record<HarnessKey, RoutingLabel> = {
  "claude-code": { name: "Claude Code", description: "Anthropic's coding agent" },
  jules: { name: "Jules", description: "Google's coding agent, in its own cloud" },
  opencode: { name: "OpenCode", description: "An open coding agent for any provider's models" },
  direct: { name: "Direct call", description: "One model call, no agent; for summaries" },
};

/** A model id as a name: "opus" reads "Opus", "gemini-2.5-flash" reads "Gemini 2.5 flash". */
export const modelName = (model: string) =>
  model.length === 0 ? "No model" : (model[0]!.toUpperCase() + model.slice(1)).replace(/-/g, " ");
