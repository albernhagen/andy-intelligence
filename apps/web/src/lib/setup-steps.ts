import type { ProjectPlan } from "@andy/contracts";

/**
 * A new project's setup path (AI-373): five steps in order, shown until the last is done. Pure, so
 * the setup page, the board's next-step bar and their tests read the same answer.
 */

export type SetupStepKey = "create" | "brief" | "plan" | "approve" | "build";
export type SetupStepState = "done" | "current" | "todo";

export interface SetupStep {
  key: SetupStepKey;
  label: string;
  state: SetupStepState;
}

export const SETUP_STEP_LABELS: Record<SetupStepKey, string> = {
  create: "Create project",
  brief: "Write the brief",
  plan: "Plan milestones",
  approve: "Approve the plan",
  build: "Baseline and first build",
};

const ORDER: readonly SetupStepKey[] = ["create", "brief", "plan", "approve", "build"];

export interface SetupFacts {
  /** `docs/product/brief.md` is on the default branch; null when it couldn't be read. */
  briefOnDefaultBranch: boolean | null;
  plan: ProjectPlan | null;
  /** The setup checklist's "baseline merged" item is done. */
  baselineMerged: boolean;
  buildEnabled: boolean;
}

/** Which steps are done. A plan implies a brief: plans are proposed from it. */
export function doneSteps(f: SetupFacts): Record<SetupStepKey, boolean> {
  const planned = f.plan !== null && f.plan.status !== "rejected";
  const approved = f.plan?.status === "approved";
  return {
    create: true,
    brief: f.briefOnDefaultBranch === true || planned,
    plan: planned,
    approve: approved,
    build: approved && f.baselineMerged && f.buildEnabled,
  };
}

/** The five steps with the first not done as current; every step done: none is current. */
export function setupSteps(f: SetupFacts): SetupStep[] {
  const done = doneSteps(f);
  const current = ORDER.find((k) => !done[k]) ?? null;
  return ORDER.map((key) => ({
    key,
    label: SETUP_STEP_LABELS[key],
    state: done[key] ? "done" : key === current ? "current" : "todo",
  }));
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

/** Step N of 5, for the card's header. */
export function stepNumber(key: SetupStepKey): number {
  return ORDER.indexOf(key) + 1;
}

export const STEP_COUNT = ORDER.length;
