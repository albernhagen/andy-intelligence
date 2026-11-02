import { describe, expect, it } from "vitest";
import { canTransition } from "./stages";

describe("canTransition", () => {
  it("GivenEachStage_WhenMovingForwardOneStep_ThenAllowed", () => {
    expect(canTransition("backlog", "ready")).toBe(true);
    expect(canTransition("ready", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "ready_for_review")).toBe(true);
    expect(canTransition("ready_for_review", "monitoring")).toBe(true);
    expect(canTransition("monitoring", "done")).toBe(true);
  });

  it("GivenRetryOrRework_WhenMovingBack_ThenAllowed", () => {
    expect(canTransition("ready", "backlog")).toBe(true);
    expect(canTransition("in_progress", "ready")).toBe(true);
    expect(canTransition("ready_for_review", "in_progress")).toBe(true);
    expect(canTransition("monitoring", "in_progress")).toBe(true);
  });

  it("GivenSkipsOrDone_WhenMoving_ThenRejected", () => {
    expect(canTransition("backlog", "in_progress")).toBe(false);
    expect(canTransition("ready", "done")).toBe(false);
    expect(canTransition("done", "backlog")).toBe(false);
    expect(canTransition("backlog", "backlog")).toBe(false);
  });
});
