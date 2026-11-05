import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "./executor-profile.mjs";
import {
  MAX_BODY,
  MAX_CHANGED_FILES,
  checkChange,
  globToRegExp,
  neutralize,
  parseRaw,
  protectedGlobs,
  pullRequest,
} from "./executor-publish.mjs";

const profile = JSON.parse(readFileSync(DEFAULT_PROFILE, "utf8"));
const OWNERS = "* @andy\n/infra/ @andy\npayments.ts @andy\n";
const globs = protectedGlobs(profile, OWNERS);
const entry = (path, dstMode = "100644", srcMode = "000000") => ({
  srcMode,
  dstMode,
  status: "A",
  path,
});

const output = {
  summary: "Adds the board. cc @someone",
  plan: {
    files: ["apps/web/src/pages/BoardPage.tsx"],
    steps: ["Write the page", "Test it"],
    tests: ["GivenTickets_WhenTheBoardOpens_ThenTheyShow"],
    riskiestStep: "Ordering by rank",
    rejectedAlternatives: ["A table"],
  },
  deviations: [],
  verification: [{ command: "pnpm test", passed: true, output: "12 passed\n```\nbreak" }],
  failingTestFiles: [],
};
const pr = (report) =>
  pullRequest({
    controlPlaneUrl: "https://ai.andybernhagen.com",
    projectId: "ai",
    ticketKey: "AI-3",
    ticketTitle: "M1.8a: Build run",
    runId: "run1",
    model: "sonnet",
    report,
  });

describe("executor publish", () => {
  it("GivenTheProfileAndCodeowners_WhenGlobsAreBuilt_ThenTrustAnchorsAndOwnedPathsButNotTheCatchAll", () => {
    expect(globs).toEqual(
      expect.arrayContaining([
        "**/.github/**",
        "**/platform/actions/**",
        "**/scripts/review-*.mjs",
        "**/CODEOWNERS",
        "**/platform/executor/**",
        "**/.claude/**",
        "infra/**",
        "**/payments.ts",
      ]),
    );
    expect(globs).not.toContain("**/*");
  });

  it("GivenGlobs_WhenMatched_ThenDoubleStarCrossesDirectoriesAndStarDoesNot", () => {
    expect(globToRegExp("**/.github/**").test(".github/workflows/ci.yml")).toBe(true);
    expect(globToRegExp("**/CODEOWNERS").test("docs/CODEOWNERS")).toBe(true);
    expect(globToRegExp("infra/**").test("infra/main.tf")).toBe(true);
    expect(globToRegExp("infra/**").test("apps/infra/main.tf")).toBe(false);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
  });

  it("GivenAnOrdinaryChange_WhenChecked_ThenItPasses", () => {
    expect(checkChange([entry("apps/web/src/a.ts"), entry("README.md")], globs)).toEqual([]);
  });

  it("GivenAWorkflowEditMadeThroughBash_WhenChecked_ThenItIsRefused", () => {
    expect(checkChange([entry(".github/workflows/ci.yml")], globs)).toEqual([
      ".github/workflows/ci.yml: protected (**/.github/**)",
    ]);
  });

  it("GivenOwnedPathsSymlinksAndSubmodules_WhenChecked_ThenEachIsRefused", () => {
    const reasons = checkChange(
      [entry("infra/main.tf"), entry("link", "120000"), entry("vendor/x", "160000")],
      globs,
    );
    expect(reasons).toHaveLength(3);
  });

  it("GivenAnEmptyOrHugeChange_WhenChecked_ThenItIsRefused", () => {
    expect(checkChange([], globs)).toEqual(["the change is empty"]);
    const many = Array.from({ length: MAX_CHANGED_FILES + 1 }, (_, i) => entry(`f${i}.ts`));
    expect(checkChange(many, globs)[0]).toContain("cap is");
  });

  it("GivenRawDiffOutput_WhenParsed_ThenModesAndPathsAreRead", () => {
    const raw =
      ":000000 100644 0000000 abc1234 A\0src/a b.ts\0:100644 000000 abc1234 0000000 D\0old.ts\0";
    expect(parseRaw(raw)).toEqual([
      { srcMode: "000000", dstMode: "100644", status: "A", path: "src/a b.ts" },
      { srcMode: "100644", dstMode: "000000", status: "D", path: "old.ts" },
    ]);
  });

  it("GivenAReport_WhenThePrIsWritten_ThenTheDescriptionStartsWithTheTicketLinkAndHasEverySection", () => {
    const { title, body } = pr({ status: "succeeded", output });
    expect(title).toBe("AI-3: M1.8a: Build run");
    expect(body.split("\n")[0]).toBe("https://ai.andybernhagen.com/p/ai/t/AI-3");
    for (const section of [
      "## Summary",
      "## Plan",
      "## Deviations from the plan",
      "## Verification",
    ]) {
      expect(body).toContain(section);
    }
    expect(body).toContain("**Riskiest step:** Ordering by rank");
  });

  it("GivenAgentTextWithMentionsAndFences_WhenThePrIsWritten_ThenNeitherSurvives", () => {
    const { body } = pr({ status: "succeeded", output });
    expect(body).not.toMatch(/@someone/);
    expect(body).not.toContain("```\nbreak");
    expect(neutralize("@a ~~~ b")).not.toMatch(/@a|~~~/);
  });

  it("GivenAHugeReportOrAMultiLineTitle_WhenThePrIsWritten_ThenBothAreCapped", () => {
    const long = { ...output, summary: "x".repeat(MAX_BODY) };
    expect(pr({ status: "succeeded", output: long }).body.length).toBeLessThanOrEqual(MAX_BODY);
    const titled = pullRequest({ ticketKey: "AI-3", ticketTitle: "a\nb", report: null });
    expect(titled.title).toBe("AI-3: a b");
  });
});
