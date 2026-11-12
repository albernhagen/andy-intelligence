import { describe, expect, it } from "vitest";
import { chooseBlock, stubTokens } from "./stub-model.mjs";

const offered = {
  tools: [{ name: "Read" }, { name: "StructuredOutput" }],
  messages: [{ role: "user", content: "x" }],
};

describe("chooseBlock", () => {
  it("GivenStructuredOutputOffered_WhenFirstAsked_ThenItCarriesTheCaseOutput", () => {
    expect(chooseBlock(offered, { summary: "s", findings: [] })).toMatchObject({
      type: "tool_use",
      name: "StructuredOutput",
      input: { summary: "s", findings: [] },
    });
  });

  it("GivenTheOutputWasAnswered_WhenAskedAgain_ThenText", () => {
    const answered = {
      ...offered,
      messages: [{ role: "user", content: [{ type: "tool_result" }] }],
    };
    expect(chooseBlock(answered, { summary: "s" }).type).toBe("text");
  });

  it("GivenNoCaseOutput_WhenAsked_ThenText", () => {
    expect(chooseBlock(offered, null).type).toBe("text");
  });
});

describe("stubTokens", () => {
  it("GivenABiggerRequest_WhenCounted_ThenMoreTokens", () => {
    expect(stubTokens("x".repeat(4000))).toBe(1000);
    expect(stubTokens("")).toBe(1);
  });
});
