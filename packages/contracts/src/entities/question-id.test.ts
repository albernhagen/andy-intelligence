import { describe, expect, it } from "vitest";
import { runQuestionId } from "../ports/work-tracker-support";
import { QuestionId } from "./common";

describe("QuestionId", () => {
  it("GivenAUuidOrARunQuestionId_WhenParsed_ThenAccepted", () => {
    expect(QuestionId.safeParse("3f2c1a9e-8b7d-4c6f-9a1b-2d3e4f5a6b7c").success).toBe(true);
    expect(QuestionId.safeParse(runQuestionId("5UUzO87nPQDzsxPMMbXp", 0)).success).toBe(true);
    expect(QuestionId.safeParse(runQuestionId("run-7", 4)).success).toBe(true);
  });

  it("GivenAPathLikeEmptyOrOverlongId_WhenParsed_ThenRejected", () => {
    for (const id of ["", "a/b", "../x", "a.b", "a b", "a%2Fb", "__x__", "x".repeat(65)]) {
      expect(QuestionId.safeParse(id).success).toBe(false);
    }
  });
});
