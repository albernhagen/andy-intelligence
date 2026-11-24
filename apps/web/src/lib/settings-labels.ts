import type { HarnessKey, ProjectSettings, ProviderKey, RunStep, TierKey } from "@andy/contracts";
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
