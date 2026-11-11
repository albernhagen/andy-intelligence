import { describe, expect, it } from "vitest";
import { checkOutput } from "./assertions.mjs";
import assertCase from "./promptfoo-assert.mjs";

const offByOne = {
  severity: "blocker",
  title: "Off-by-one for pages past 3",
  file: "packages/domain/src/paging.ts",
  scenario: "pageOf(items, 4, 3) skips an item",
  recommendation: "Drop the page > 3 branch",
};
const nit = {
  severity: "question",
  title: "Naming",
  scenario: "unclear",
  recommendation: "rename",
};

describe("checkOutput", () => {
  it("GivenMatchingBlocker_WhenFindingChecked_ThenPasses", () => {
    const check = {
      check: "finding",
      severity: ["blocker"],
      file: "paging.ts",
      mentions: ["Off-by-one"],
    };
    expect(checkOutput({ findings: [nit, offByOne] }, [check])).toEqual([]);
  });

  it("GivenOnlyAQuestion_WhenBlockerExpected_ThenFailsWithFixedMessage", () => {
    const check = { check: "finding", severity: ["blocker"], file: "paging.ts" };
    expect(checkOutput({ findings: [nit] }, [check])).toEqual([
      "expected a blocker finding in a file ending paging.ts: none",
    ]);
  });

  it("GivenBlockerInAnotherFile_WhenFileChecked_ThenFails", () => {
    const check = { check: "finding", severity: ["blocker"], file: "other.ts" };
    expect(checkOutput({ findings: [offByOne] }, [check])).toHaveLength(1);
  });

  it("GivenNoMentionedWord_WhenMentionsChecked_ThenFails", () => {
    const check = { check: "finding", severity: ["blocker"], mentions: ["injection"] };
    expect(checkOutput({ findings: [offByOne] }, [check])).toEqual([
      "expected a blocker finding mentioning one of: injection: none",
    ]);
  });

  it("GivenABlocker_WhenNoFindingChecked_ThenFails", () => {
    const check = { check: "no-finding", severity: ["blocker"] };
    expect(checkOutput({ findings: [offByOne] }, [check])).toEqual([
      "expected no blocker finding: got 1",
    ]);
    expect(checkOutput({ findings: [nit] }, [check])).toEqual([]);
  });

  it("GivenTooManyFindings_WhenMaxChecked_ThenFails", () => {
    expect(checkOutput({ findings: [nit, nit, nit] }, [{ check: "max-findings", max: 2 }])).toEqual(
      ["expected at most 2 findings: got 3"],
    );
    expect(checkOutput({ findings: [nit, nit] }, [{ check: "max-findings", max: 2 }])).toEqual([]);
  });

  it("GivenNoFindingsList_WhenChecked_ThenFails", () => {
    expect(checkOutput({ summary: "x" }, [{ check: "max-findings", max: 2 }])).toEqual([
      "output has no findings list",
    ]);
  });

  it("GivenModelText_WhenAFailureIsReported_ThenTheMessageHoldsNoneOfIt", () => {
    const hostile = { ...nit, title: "SECRET-TOKEN-abc", scenario: "SECRET-TOKEN-abc" };
    const failures = checkOutput({ findings: [hostile] }, [
      { check: "finding", severity: ["blocker"] },
    ]);
    expect(failures.join(" ")).not.toContain("SECRET");
  });
});

describe("promptfoo assertion", () => {
  const context = {
    test: { metadata: { expect: [{ check: "no-finding", severity: ["blocker"] }] } },
  };

  it("GivenACleanOutput_WhenAsserted_ThenPasses", () => {
    expect(assertCase(JSON.stringify({ summary: "ok", findings: [] }), context)).toMatchObject({
      pass: true,
    });
  });

  it("GivenABlocker_WhenAsserted_ThenFailsWithReason", () => {
    expect(assertCase(JSON.stringify({ summary: "x", findings: [offByOne] }), context)).toEqual({
      pass: false,
      score: 0,
      reason: "expected no blocker finding: got 1",
    });
  });

  it("GivenNonJson_WhenAsserted_ThenFails", () => {
    expect(assertCase("not json", context)).toMatchObject({
      pass: false,
      reason: "output is not JSON",
    });
  });
});
