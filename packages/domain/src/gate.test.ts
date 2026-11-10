import { Project } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import {
  TOOLING_GLOBS,
  codeownersGlobs,
  decideGate,
  policyAllows,
  protectedFiles,
  type GateFacts,
} from "./gate";
import { revertedPullRequest } from "./gate-service";

const file = (path: string, previousPath: string | null = null) => ({ path, previousPath });
const check = (name: string, conclusion: "success" | "failure" | "neutral" = "success") => ({
  name,
  status: "completed" as const,
  conclusion,
  sourceId: "15368",
});
const required = ["check", "adversarial-review", "security-review"].map((name) => ({
  name,
  sourceId: "15368",
}));

const facts = (over: Partial<GateFacts> = {}): GateFacts => ({
  verification: [{ command: "pnpm test", passed: true, output: "12 passed" }],
  draft: false,
  intoDefaultBranch: true,
  files: { items: [file("apps/web/src/pages/BoardPage.tsx")], complete: true },
  codeowners: [],
  required,
  checks: { items: required.map((r) => check(r.name)), complete: true },
  ...over,
});

describe("protected paths", () => {
  it.each([
    ".github/workflows/ci.yml",
    "template/.github/CODEOWNERS",
    "CODEOWNERS",
    "platform/executor/run.sh",
    "scripts/executor-publish.mjs",
    "infra/live/main.tf",
    "apps/api/src/auth.ts",
    "apps/api/src/mcp/oauth.ts",
    "apps/web/src/OAuthConsent.tsx",
    "packages/domain/src/gate.ts",
    "package.json",
    "apps/web/package.json",
    "pnpm-lock.yaml",
    "apps/web/vite.config.ts",
    ".GITHUB/workflows/ci.yml",
    ".claude/settings.json",
    ".vscode/tasks.json",
    ".devcontainer/devcontainer.json",
    "docs/BUILD-PROMPT.md",
    "docs/security/threat-model.md",
    "docs/architecture/adr/0001-x.md",
    "context-budget.json",
    "packages/github/src/code-host.ts",
    "packages/contracts/src/ports/index.ts",
    "packages/domain/src/build-dispatch.ts",
    "apps/api/src/app.ts",
    "apps/api/src/oauth/token.ts",
    "apps/api/src/authz.ts",
    "src/permission/check.ts",
    "db/migration/001.ts",
    "db/schema.sql",
  ])("GivenPath_%s_WhenMatched_ThenItIsProtected", (path) => {
    expect(protectedFiles([file(path)], [])).toEqual([path]);
  });

  it("GivenAnOrdinaryPath_WhenMatched_ThenItIsNotProtected", () => {
    expect(protectedFiles([file("apps/web/src/pages/BoardPage.tsx")], [])).toEqual([]);
    expect(protectedFiles([file("docs/author-notes.md")], [])).toEqual([]);
  });

  it("GivenARenameOutOfAProtectedDirectory_WhenMatched_ThenTheOldNameCounts", () => {
    expect(protectedFiles([file("docs/notes.md", "infra/live/main.tf")], [])).toEqual([
      "infra/live/main.tf",
    ]);
  });

  it("GivenARenameIntoAProtectedDirectory_WhenMatched_ThenTheNewNameCounts", () => {
    expect(protectedFiles([file("infra/x.tf", "docs/x.tf")], [])).toEqual(["infra/x.tf"]);
  });

  it("GivenThePublishScript_WhenItsToolingGlobsAreCompared_ThenTheGateHasTheSameList", async () => {
    const path = new URL("../../../scripts/executor-publish.mjs", import.meta.url).href;
    const script = (await import(/* @vite-ignore */ path)) as { TOOLING_GLOBS: string[] };
    expect(TOOLING_GLOBS).toEqual(script.TOOLING_GLOBS);
  });
});

describe("Project.autoMerge", () => {
  it("GivenAProjectDocumentOlderThanTheField_WhenRead_ThenItIsNone", () => {
    const stored = {
      id: "ai",
      name: "AI",
      repos: [],
      key: "AI",
      gcpDevProjectId: null,
      gcpProdProjectId: null,
      autonomy: "gated",
      monthlyBudgetUsd: null,
      enabled: true,
    };
    expect(Project.parse(stored).autoMerge).toBe("none");
  });
});

describe("codeownersGlobs", () => {
  it("GivenTheCatchAll_WhenParsed_ThenItProtectsNothing", () => {
    expect(codeownersGlobs("# comment\n\n* @albernhagen\n")).toEqual([]);
  });

  it("GivenListedPaths_WhenMatched_ThenTheyAreProtected", () => {
    const globs = codeownersGlobs("* @a\n/billing/ @a\nsrc/core @a\n*.sql @a\nsecrets @a\n");
    const hit = (p: string) => protectedFiles([file(p)], globs).length > 0;
    expect(hit("billing/invoice.ts")).toBe(true);
    expect(hit("src/core/a.ts")).toBe(true);
    expect(hit("db/schema.sql")).toBe(true);
    expect(hit("apps/secrets/key.ts")).toBe(true);
    expect(hit("apps/web/billing.ts")).toBe(false);
  });
});

describe("policyAllows", () => {
  it.each([
    ["none", "S", false],
    ["s", "S", true],
    ["s", "M", false],
    ["s-and-m", "M", true],
    ["s-and-m", "L", false],
    ["all", "L", true],
    ["all", null, false],
  ] as const)("GivenPolicy_%s_AndSize_%s_WhenChecked_Then_%s", (policy, size, allowed) => {
    expect(policyAllows(policy, size)).toBe(allowed);
  });
});

describe("decideGate", () => {
  it("GivenASyncQueuedOrRunningForThePr_WhenDecided_ThenNoAutoMergeAndNoFlag", () => {
    expect(decideGate(facts({ syncPending: true }))).toMatchObject({
      wouldAutoMerge: false,
      reasons: ["sync_pending"],
      flag: false,
    });
  });

  it("GivenAllPassing_WhenDecided_ThenItWouldMerge", () => {
    expect(decideGate(facts())).toMatchObject({ wouldAutoMerge: true, reasons: [], flag: false });
  });

  it("GivenNoVerification_WhenDecided_ThenVetoedAndFlagged", () => {
    expect(decideGate(facts({ verification: [] }))).toMatchObject({
      wouldAutoMerge: false,
      reasons: ["no_verification_output"],
      flag: true,
    });
  });

  it("GivenABlankCheckOutput_WhenDecided_ThenVetoed", () => {
    const verification = [{ command: "pnpm test", passed: true, output: "  \n" }];
    expect(decideGate(facts({ verification })).reasons).toEqual(["no_verification_output"]);
  });

  it("GivenAProtectedPath_WhenDecided_ThenVetoedFlaggedAndListed", () => {
    const decision = decideGate(facts({ files: { items: [file("infra/a.tf")], complete: true } }));
    expect(decision).toMatchObject({
      wouldAutoMerge: false,
      reasons: ["protected_path"],
      protectedFiles: ["infra/a.tf"],
      flag: true,
    });
  });

  it("GivenAnIncompleteFileList_WhenDecided_ThenVetoedNotAssumedClean", () => {
    expect(decideGate(facts({ files: { items: [], complete: false } }))).toMatchObject({
      wouldAutoMerge: false,
      reasons: ["files_incomplete"],
      flag: true,
    });
  });

  it("GivenNoRequiredChecks_WhenDecided_ThenVetoed", () => {
    expect(decideGate(facts({ required: [] })).reasons).toContain("no_required_checks");
  });

  it("GivenARequiredCheckMissing_WhenDecided_ThenPending", () => {
    const checks = {
      items: [check("adversarial-review"), check("security-review")],
      complete: true,
    };
    expect(decideGate(facts({ checks })).reasons).toEqual(["checks_pending"]);
  });

  it("GivenAFailingRequiredCheck_WhenDecided_ThenFailedAndCiFailedSet", () => {
    const checks = {
      items: [check("check", "failure"), check("adversarial-review"), check("security-review")],
      complete: true,
    };
    expect(decideGate(facts({ checks }))).toMatchObject({
      reasons: ["checks_failed"],
      ciFailed: true,
      flag: false,
    });
  });

  it("GivenAReviewBlocker_WhenDecided_ThenItCountsAsAReviewFailureNotCi", () => {
    const checks = {
      items: [check("check"), check("adversarial-review", "failure"), check("security-review")],
      complete: true,
    };
    expect(decideGate(facts({ checks }))).toMatchObject({
      reasons: ["checks_failed"],
      ciFailed: false,
      failedReviews: ["adversarial-review"],
    });
  });

  it("GivenAReviewAgentThatErroredNeutral_WhenDecided_ThenNotAPassButNotABlocker", () => {
    const checks = {
      items: [check("check"), check("adversarial-review", "neutral"), check("security-review")],
      complete: true,
    };
    expect(decideGate(facts({ checks }))).toMatchObject({
      reasons: ["checks_failed"],
      failedReviews: [],
    });
  });

  it("GivenARequiredCheckFromAnotherReporter_WhenDecided_ThenItDoesNotCount", () => {
    const checks = {
      items: [
        { ...check("check"), sourceId: "999" },
        check("adversarial-review"),
        check("security-review"),
      ],
      complete: true,
    };
    expect(decideGate(facts({ checks })).reasons).toEqual(["checks_pending"]);
  });

  it("GivenAReviewCheckFromAnotherReporter_WhenTheRulesOmitIt_ThenItDoesNotCount", () => {
    const rules = [{ name: "check", sourceId: "15368" }];
    const fake = { ...check("security-review"), sourceId: "999" };
    const checks = { items: [check("check"), check("adversarial-review"), fake], complete: true };
    expect(decideGate(facts({ required: rules, checks })).reasons).toEqual(["checks_pending"]);
  });

  it("GivenNoReporterInTheRules_WhenDecided_ThenAReviewCheckCannotPass", () => {
    const rules = [{ name: "check", sourceId: null }];
    expect(decideGate(facts({ required: rules })).reasons).toEqual(["checks_pending"]);
  });

  it("GivenDraftOrOtherBase_WhenDecided_ThenVetoed", () => {
    expect(decideGate(facts({ draft: true })).reasons).toEqual(["draft"]);
    expect(decideGate(facts({ intoDefaultBranch: false })).reasons).toEqual(["not_default_branch"]);
  });
});

describe("revertedPullRequest", () => {
  it("GivenGitHubsRevertBranchOrLine_WhenRead_ThenTheNumberIsFound", () => {
    expect(revertedPullRequest({ headRef: "revert-40-agent/AI-1/r", bodyFirstLine: "" })).toBe(40);
    expect(revertedPullRequest({ headRef: "x", bodyFirstLine: "Reverts a/b#41" })).toBe(41);
    expect(revertedPullRequest({ headRef: "x", bodyFirstLine: "Fixes a/b#41" })).toBeNull();
  });
});
