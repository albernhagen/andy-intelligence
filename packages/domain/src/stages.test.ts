import { describe, expect, it } from "vitest";
import { Stage } from "@andy/contracts";
import {
  PIPELINE,
  TRANSITIONS,
  canTransition,
  forwardPath,
  isForwardMove,
  pullRequestPath,
} from "./stages";

describe("canTransition", () => {
  it("GivenEachStage_WhenMovingForwardOneStep_ThenAllowed", () => {
    expect(canTransition("backlog", "ready")).toBe(true);
    expect(canTransition("ready", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "ready_for_review")).toBe(true);
    expect(canTransition("ready_for_review", "done")).toBe(true);
  });

  it("GivenRetryOrRework_WhenMovingBack_ThenAllowed", () => {
    expect(canTransition("ready", "backlog")).toBe(true);
    expect(canTransition("in_progress", "ready")).toBe(true);
    expect(canTransition("ready_for_review", "in_progress")).toBe(true);
  });

  it("GivenSkipsOrDone_WhenMoving_ThenRejected", () => {
    expect(canTransition("backlog", "in_progress")).toBe(false);
    expect(canTransition("ready", "done")).toBe(false);
    expect(canTransition("done", "backlog")).toBe(false);
    expect(canTransition("backlog", "backlog")).toBe(false);
  });

  it("GivenCancelled_WhenMoving_ThenOnlyReopeningToBacklogIsAllowedAndNothingMovesIn", () => {
    expect(canTransition("cancelled", "backlog")).toBe(true);
    expect(canTransition("cancelled", "ready")).toBe(false);
    expect(canTransition("done", "cancelled")).toBe(false);
    expect(canTransition("in_progress", "cancelled")).toBe(false);
  });
});

describe("isForwardMove", () => {
  it("GivenOneStepForward_WhenChecked_ThenTrue", () => {
    expect(isForwardMove("ready", "in_progress")).toBe(true);
    expect(isForwardMove("ready_for_review", "done")).toBe(true);
  });

  it("GivenABackwardOrSkippingMove_WhenChecked_ThenFalse", () => {
    expect(isForwardMove("in_progress", "ready")).toBe(false);
    expect(isForwardMove("ready_for_review", "in_progress")).toBe(false);
    expect(isForwardMove("ready", "ready_for_review")).toBe(false);
    expect(isForwardMove("done", "done")).toBe(false);
  });

  it("GivenACancelledTicket_WhenReopeningIsChecked_ThenItIsNotAForwardMove", () => {
    expect(isForwardMove("cancelled", "backlog")).toBe(false);
    expect(isForwardMove("ready_for_review", "cancelled")).toBe(false);
  });
});

describe("forwardPath", () => {
  it("GivenAStageAhead_WhenWalked_ThenEveryStepInOrder", () => {
    expect(forwardPath("ready", "ready_for_review")).toEqual(["in_progress", "ready_for_review"]);
    expect(forwardPath("ready_for_review", "done")).toEqual(["done"]);
  });

  it("GivenAStageBehindOrTheSame_WhenWalked_ThenEmpty", () => {
    expect(forwardPath("done", "ready_for_review")).toEqual([]);
    expect(forwardPath("in_progress", "in_progress")).toEqual([]);
  });
});

describe("Stage (ADR-0069: no Monitoring stage until M6)", () => {
  it("GivenTheStageList_WhenRead_ThenThereIsNoMonitoringStage", () => {
    expect(PIPELINE).toEqual(["backlog", "ready", "in_progress", "ready_for_review", "done"]);
    expect(Stage.options).not.toContain("monitoring");
    expect(Object.keys(TRANSITIONS)).not.toContain("monitoring");
  });

  it("GivenMonitoringAsInput_WhenParsedAsAStage_ThenRejected", () => {
    expect(Stage.safeParse("monitoring").success).toBe(false);
  });
});

describe("pullRequestPath", () => {
  it("GivenAnyStageBeforeReview_WhenAPullRequestOpens_ThenEveryStepToReview", () => {
    expect(pullRequestPath("backlog", "ready_for_review")).toEqual([
      "ready",
      "in_progress",
      "ready_for_review",
    ]);
    expect(pullRequestPath("in_progress", "ready_for_review")).toEqual(["ready_for_review"]);
  });

  it("GivenAnyStageBeforeDone_WhenAPullRequestMerges_ThenEveryStepToDone", () => {
    expect(pullRequestPath("backlog", "done")).toEqual([
      "ready",
      "in_progress",
      "ready_for_review",
      "done",
    ]);
    expect(pullRequestPath("ready_for_review", "done")).toEqual(["done"]);
  });

  it("GivenDoneCancelledOrPastReview_WhenAPullRequestEvent_ThenNoMove", () => {
    expect(pullRequestPath("done", "done")).toEqual([]);
    expect(pullRequestPath("cancelled", "done")).toEqual([]);
    expect(pullRequestPath("cancelled", "ready_for_review")).toEqual([]);
    expect(pullRequestPath("ready_for_review", "ready_for_review")).toEqual([]);
  });
});
