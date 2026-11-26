import type { Onboarding, OnboardingStepKey, ProjectPlan } from "@andy/contracts";

/**
 * A new project's setup path (AI-373, AI-381): every step of runbook `managed-project.md` plus
 * the brief, plan and approve steps, in one order, shown until the last is done. Pure, so the
 * setup page, the board's next-step bar and their tests read the same answer.
 *
 * Order: the GitHub and terminal steps come first because the brief is a PR on the repo (its
 * checks need the baseline workflows and the reviewer token); the proving refine needs a ticket
 * from the approved plan; Builds on comes last, as in the runbook. Creating the repo and
 * installing the App also show on Add project, since the project needs both first.
 */

export type ProductStepKey = "brief" | "plan" | "approve";
export type SetupStepKey = OnboardingStepKey | ProductStepKey;
export type SetupStepState = "done" | "current" | "todo";

export interface SetupStep {
  key: SetupStepKey;
  label: string;
  state: SetupStepState;
}

const PRODUCT_LABELS: Record<ProductStepKey, string> = {
  brief: "Write the brief",
  plan: "Plan milestones",
  approve: "Approve the plan",
};

const ORDER: readonly SetupStepKey[] = [
  "repo_app",
  "baseline_pr",
  "repo_settings",
  "deploy_env",
  "reusable_workflows",
  "reviewer_token",
  "agent_environment",
  "brief",
  "plan",
  "approve",
  "proving_refine",
  "builds_on",
];

/** Steps done in GitHub or the terminal: they can be opened in any order. */
const HAND_STEPS: ReadonlySet<SetupStepKey> = new Set<SetupStepKey>([
  "repo_app",
  "baseline_pr",
  "repo_settings",
  "deploy_env",
  "reusable_workflows",
  "reviewer_token",
  "agent_environment",
]);

export interface SetupFacts {
  /** `docs/product/brief.md` is on the default branch; null when it couldn't be read. */
  briefOnDefaultBranch: boolean | null;
  plan: ProjectPlan | null;
  onboarding: Onboarding;
}

const isProduct = (k: SetupStepKey): k is ProductStepKey => k in PRODUCT_LABELS;

export function stepLabel(key: SetupStepKey, f: SetupFacts): string {
  return isProduct(key) ? PRODUCT_LABELS[key] : onboardingStep(f, key).label;
}

export function onboardingStep(f: SetupFacts, key: OnboardingStepKey) {
  return f.onboarding.steps.find((s) => s.key === key)!;
}

/** Which steps are done. A plan implies a brief: plans are proposed from it. */
export function doneSteps(f: SetupFacts): Record<SetupStepKey, boolean> {
  const planned = f.plan !== null && f.plan.status !== "rejected";
  const done = Object.fromEntries(
    f.onboarding.steps.map((s) => [s.key, s.status === "done"]),
  ) as Record<OnboardingStepKey, boolean>;
  return {
    ...done,
    brief: f.briefOnDefaultBranch === true || planned,
    plan: planned,
    approve: f.plan?.status === "approved",
  };
}

/** Every step with the first not done as current; every step done: none is current. */
export function setupSteps(f: SetupFacts): SetupStep[] {
  const done = doneSteps(f);
  const current = ORDER.find((k) => !done[k]) ?? null;
  return ORDER.map((key) => ({
    key,
    label: stepLabel(key, f),
    state: done[key] ? "done" : key === current ? "current" : "todo",
  }));
}

/** A step can be opened: done, current, or a hand step (done in GitHub, in any order). */
export function canOpen(step: SetupStep): boolean {
  return step.state !== "todo" || HAND_STEPS.has(step.key);
}

/** The step to do next, or null once setup is finished. */
export function nextStep(f: SetupFacts): SetupStep | null {
  return setupSteps(f).find((s) => s.state === "current") ?? null;
}

/**
 * Whether the board shows the setup bar: only a project still being set up. A project with story
 * tickets is being built already (the projects made before this path have no plan), so it never
 * shows there; the setup page itself is always reachable.
 */
export function showsSetupBar(storyCount: number, f: SetupFacts): boolean {
  return storyCount === 0 && nextStep(f) !== null;
}

/** Step N of 11, for the card's header. */
export function stepNumber(key: SetupStepKey): number {
  return ORDER.indexOf(key) + 1;
}

export const STEP_COUNT = ORDER.length;
