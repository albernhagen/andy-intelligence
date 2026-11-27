import { describe, expect, it } from "vitest";
import type { ProjectPlan } from "@andy/contracts";
import { onboardingFixture } from "./onboarding-fixture";
import {
  STEP_COUNT,
  canOpen,
  nextStep,
  setupSteps,
  showsSetupBar,
  type SetupFacts,
} from "./setup-steps";

const plan = (status: ProjectPlan["status"]) => ({ status }) as ProjectPlan;
const handDone = onboardingFixture({ proving_refine: "not_yet", builds_on: "not_yet" });
const fresh: SetupFacts = { briefOnDefaultBranch: false, plan: null, onboarding: handDone };

describe("setup steps", () => {
  it("GivenTheRunbookAndTheProductSteps_WhenRead_ThenEveryStepShowsInOneOrder", () => {
    expect(setupSteps(fresh).map((s) => s.key)).toEqual([
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
    ]);
    expect(STEP_COUNT).toBe(12);
  });

  it("GivenANewProjectWithoutTheBaseline_WhenRead_ThenTheBaselineStepIsNext", () => {
    const f = { ...fresh, onboarding: onboardingFixture({ baseline_pr: "not_yet" }) };
    expect(nextStep(f)?.key).toBe("baseline_pr");
  });

  it("GivenTheGitHubStepsDone_WhenRead_ThenTheBriefIsNext", () => {
    expect(nextStep(fresh)?.key).toBe("brief");
  });

  it("GivenTheBriefMerged_WhenRead_ThenPlanningIsNext", () => {
    expect(nextStep({ ...fresh, briefOnDefaultBranch: true })?.key).toBe("plan");
  });

  it("GivenAProposedPlan_WhenRead_ThenApprovalIsNextEvenIfTheBriefCantBeRead", () => {
    expect(nextStep({ ...fresh, briefOnDefaultBranch: null, plan: plan("proposed") })?.key).toBe(
      "approve",
    );
  });

  it("GivenARejectedPlan_WhenRead_ThenPlanningIsNextAgain", () => {
    expect(nextStep({ ...fresh, briefOnDefaultBranch: true, plan: plan("rejected") })?.key).toBe(
      "plan",
    );
  });

  it("GivenAnApprovedPlan_WhenRead_ThenTheProvingRefineIsNext", () => {
    expect(nextStep({ ...fresh, plan: plan("approved") })?.key).toBe("proving_refine");
  });

  it("GivenEveryStepDone_WhenRead_ThenNoNextStepAndNoBar", () => {
    const done = { ...fresh, plan: plan("approved"), onboarding: onboardingFixture() };
    expect(nextStep(done)).toBeNull();
    expect(showsSetupBar(0, done)).toBe(false);
  });

  it("GivenAnUnreadableHandStep_WhenRead_ThenLaterHandStepsCanStillBeOpened", () => {
    const f = {
      ...fresh,
      onboarding: onboardingFixture({ repo_settings: "unknown", reviewer_token: "not_yet" }),
    };
    const steps = setupSteps(f);
    expect(steps.find((s) => s.key === "repo_settings")?.state).toBe("current");
    expect(canOpen(steps.find((s) => s.key === "reviewer_token")!)).toBe(true);
    expect(canOpen(steps.find((s) => s.key === "plan")!)).toBe(false);
  });

  it("GivenStoryTickets_WhenSetupIsUnfinished_ThenTheBoardShowsNoBar", () => {
    expect(showsSetupBar(3, fresh)).toBe(false);
    expect(showsSetupBar(0, fresh)).toBe(true);
  });
});
