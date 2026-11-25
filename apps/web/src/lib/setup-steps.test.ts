import { describe, expect, it } from "vitest";
import type { ProjectPlan } from "@andy/contracts";
import { nextStep, setupSteps, showsSetupBar, type SetupFacts } from "./setup-steps";

const plan = (status: ProjectPlan["status"]) => ({ status }) as ProjectPlan;
const fresh: SetupFacts = {
  briefOnDefaultBranch: false,
  plan: null,
  baselineMerged: false,
  buildEnabled: false,
};

describe("setup steps", () => {
  it("GivenANewProject_WhenStepsAreRead_ThenCreateIsDoneAndTheBriefIsNext", () => {
    expect(setupSteps(fresh).map((s) => s.state)).toEqual([
      "done",
      "current",
      "todo",
      "todo",
      "todo",
    ]);
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

  it("GivenAnApprovedPlanWithoutTheBaseline_WhenRead_ThenTheBuildStepIsNext", () => {
    expect(nextStep({ ...fresh, plan: plan("approved"), buildEnabled: true })?.key).toBe("build");
  });

  it("GivenEveryStepDone_WhenRead_ThenNoNextStepAndNoBar", () => {
    const done = { ...fresh, plan: plan("approved"), baselineMerged: true, buildEnabled: true };
    expect(nextStep(done)).toBeNull();
    expect(showsSetupBar(0, done)).toBe(false);
  });

  it("GivenStoryTickets_WhenSetupIsUnfinished_ThenTheBoardShowsNoBar", () => {
    expect(showsSetupBar(3, fresh)).toBe(false);
    expect(showsSetupBar(0, fresh)).toBe(true);
  });
});
