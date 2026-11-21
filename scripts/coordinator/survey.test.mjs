import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HEAD, cleanPr, fakeGh, reviewBody } from "./fake-gh.mjs";
import {
  HIGH_RISK_ADR,
  highRiskPatterns,
  highRiskTouched,
  latestReviews,
  parseReview,
} from "./lib.mjs";
import { format, surveyPr } from "./survey.mjs";

const patterns = highRiskPatterns(readFileSync(HIGH_RISK_ADR, "utf8"));
const survey = (pr) =>
  surveyPr(pr.view.number, { run: fakeGh({ [pr.view.number]: pr }).run, patterns });
const bot = (body, updated_at = "2026-11-20T02:00:00Z") => ({
  login: "github-actions[bot]",
  body,
  updated_at,
});

describe("survey", () => {
  it("GivenCleanPr_WhenSurveyed_ThenNoBlockers", () => {
    const report = survey(cleanPr(7));
    expect(report.blockers).toEqual([]);
    expect(report.checks).toMatchObject({ pass: 1, skipping: 1, failing: [] });
    expect(format(report)).toContain("mergeable by §7's mechanical rules");
  });

  it("GivenHeadBehindMain_WhenSurveyed_ThenBlocked", () => {
    expect(survey(cleanPr(7, { behindBy: 3 })).blockers).toContain(
      "head is 3 commit(s) behind main",
    );
  });

  it("GivenCompareCallFails_WhenSurveyed_ThenSyncUnknownAndBlocked", () => {
    const report = survey(cleanPr(7, { compareError: true }));
    expect(report.sync.error).toMatch(/502/);
    expect(report.blockers.join()).toMatch(/sync unknown/);
  });

  it("GivenFailingAndPendingChecks_WhenSurveyed_ThenBothReported", () => {
    const checks = [
      { name: "ci", bucket: "fail" },
      { name: "build", bucket: "pending" },
      { name: "lint", bucket: "pass" },
    ];
    const report = survey(cleanPr(7, { checks }));
    expect(report.blockers).toEqual(
      expect.arrayContaining(["failing checks: ci", "1 check(s) pending"]),
    );
  });

  it("GivenNoChecksReported_WhenSurveyed_ThenChecksUnknownAndBlocked", () => {
    expect(survey(cleanPr(7, { checksError: true })).blockers.join()).toMatch(/checks unknown/);
  });

  it("GivenVerdictOnOlderCommit_WhenSurveyed_ThenBlocked", () => {
    const comments = [
      bot(reviewBody("security", { sha: "b".repeat(40) })),
      bot(reviewBody("adversarial")),
    ];
    expect(survey(cleanPr(7, { comments })).blockers).toContain(
      "security verdict is not on the head",
    );
  });

  it("GivenOpenShouldFix_WhenSurveyed_ThenBlockedAndFindingListed", () => {
    const adversarial = reviewBody("adversarial", {
      counts: "blocker 0 · should-fix 1 · question 0",
      rows: [["should-fix", "Missing ADR"]],
    });
    const report = survey(
      cleanPr(7, { comments: [bot(reviewBody("security")), bot(adversarial)] }),
    );
    expect(report.blockers).toContain("adversarial: should-fix 1");
    expect(format(report)).toContain("should-fix: Missing ADR");
  });

  it("GivenNeutralReview_WhenSurveyed_ThenNotOnHead", () => {
    const neutral =
      "<!-- security-review -->\n### ⚠️ Security review: not reviewed\n\nThe agent didn't run.";
    const report = survey(cleanPr(7, { comments: [bot(neutral), bot(reviewBody("adversarial"))] }));
    expect(report.blockers).toContain("security verdict is not on the head");
  });

  it("GivenMarkerPastedByAHuman_WhenSurveyed_ThenIgnored", () => {
    const fake = {
      login: "someone",
      body: reviewBody("security"),
      updated_at: "2026-11-21T00:00:00Z",
    };
    const report = survey(cleanPr(7, { comments: [fake, bot(reviewBody("adversarial"))] }));
    expect(report.blockers).toContain("no security verdict");
  });

  it("GivenAnyLabel_WhenSurveyed_ThenBlocked", () => {
    const pr = cleanPr(7);
    pr.view.labels = [{ name: "review-accepted" }];
    expect(survey(pr).blockers).toContain("labels: review-accepted");
  });

  it("GivenDraftForkOrOtherBase_WhenSurveyed_ThenEachBlocks", () => {
    const pr = cleanPr(7);
    Object.assign(pr.view, { isDraft: true, isCrossRepository: true, mergeStateStatus: "DIRTY" });
    expect(survey(pr).blockers).toEqual(
      expect.arrayContaining(["draft", "from a fork", "merge state DIRTY"]),
    );
  });

  it("GivenDiffTouchingProcedures_WhenSurveyed_ThenHighRiskPathListed", () => {
    const report = survey(
      cleanPr(7, { files: ["platform/procedures/coordinate.md", "apps/web/x.ts"] }),
    );
    expect(report.highRisk).toEqual(["platform/procedures/"]);
  });
});

describe("high-risk patterns", () => {
  it("GivenAdr0092_WhenParsed_ThenPathTokensOnly", () => {
    expect(patterns).toEqual(
      expect.arrayContaining([
        ".github/",
        "infra/",
        "scripts/review-*.mjs",
        "AGENTS.md",
        "docs/architecture/*.md",
      ]),
    );
    expect(patterns).not.toContain("terraform apply");
  });

  it.each([
    [".github/workflows/ci.yml", ".github/"],
    ["scripts/review-gate.mjs", "scripts/review-*.mjs"],
    ["packages/contracts/src/a.ts", "packages/contracts"],
    ["apps/api/AGENTS.md", "AGENTS.md"],
    ["platform/baseline/manifest.json", "platform/baseline/**"],
  ])("GivenFile%s_WhenMatched_ThenPattern%s", (file, pattern) => {
    expect(highRiskTouched([file], patterns)).toContain(pattern);
  });

  it.each([
    "scripts/reviewer.txt",
    "docs/architecture/adr/0001-x.md",
    "packages/contracts-extra/a.ts",
    "apps/web/src/a.ts",
  ])("GivenFile%s_WhenMatched_ThenNotHighRiskByPath", (file) => {
    expect(highRiskTouched([file], patterns)).toEqual([]);
  });
});

describe("parseReview", () => {
  it("GivenGateComment_WhenParsed_ThenCountsVerdictAndSha", () => {
    const parsed = parseReview(
      reviewBody("security", {
        counts: "critical 0 · high 2 · medium 1 · low 0 · info 0",
        rows: [
          ["high", "Token leak"],
          ["medium", "x"],
        ],
      }),
      HEAD,
    );
    expect(parsed).toMatchObject({
      onHead: true,
      sha: HEAD,
      counts: { high: 2, medium: 1 },
      blocking: [{ severity: "high", title: "Token leak" }],
    });
  });

  it("GivenTwoComments_WhenPickingLatest_ThenNewestWins", () => {
    const old = bot(reviewBody("security", { sha: "b".repeat(40) }), "2026-11-19T00:00:00Z");
    const latest = latestReviews([bot(reviewBody("security")), old]);
    expect(parseReview(latest.security, HEAD).onHead).toBe(true);
    expect(latest.adversarial).toBeNull();
  });
});
