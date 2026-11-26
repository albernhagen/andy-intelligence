import type { ChangedFile, MergeMode, ReviewFinding } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import {
  highRiskFiles,
  keptFiles,
  mergeVerdict,
  openFindingsOn,
  type MergeFacts,
} from "./merge-verdict";

const file = (path: string, previousPath?: string): ChangedFile =>
  ({ path, ...(previousPath ? { previousPath } : {}) }) as ChangedFile;

/** A clean PR touching one plain product file. */
const clean = (over: Partial<MergeFacts> = {}): MergeFacts => ({
  gateClean: true,
  files: { items: [file("apps/web/src/pages/BoardPage.tsx")], complete: true },
  labels: [],
  upToDate: true,
  openFindings: 0,
  readyForReview: true,
  mainChecks: { state: "passed", failing: [] },
  ...over,
});

describe("mergeVerdict", () => {
  it("GivenOwnerApproval_WhenACleanPrTouchesAKeptPathInManualModeWithAnAcceptedLabel_ThenItMerges", () => {
    const v = mergeVerdict(
      clean({
        files: { items: [file(".github/workflows/ci.yml")], complete: true },
        labels: ["review-accepted"],
      }),
      "manual",
      { ownerApproval: true },
    );
    expect(v).toMatchObject({
      verdict: "merge",
      reasons: [],
      keptFiles: [".github/workflows/ci.yml"],
    });
  });

  it.each<MergeMode | null>([null, "epic", "low-risk"])(
    "GivenOwnerApproval_WhenTheModeIs %s_ThenTheModeAndHighRiskPathsAreWaived",
    (mode) => {
      const v = mergeVerdict(
        clean({ files: { items: [file("infra/control-plane/main.tf")], complete: true } }),
        mode,
        { ownerApproval: true },
      );
      expect(v.verdict).toBe("merge");
    },
  );

  it("GivenOwnerApproval_WhenThePrIsNotCleanBehindOrMainIsRed_ThenItStillWaitsWithThoseReasons", () => {
    const v = mergeVerdict(
      clean({
        gateClean: false,
        upToDate: false,
        openFindings: 1,
        readyForReview: false,
        files: { items: [file(".github/CODEOWNERS")], complete: false },
        labels: null,
        mainChecks: { state: "failed", failing: ["ci"] },
      }),
      "manual",
      { ownerApproval: true },
    );
    expect(v.verdict).toBe("wait");
    expect(v.reasons).toEqual([
      "gate_not_clean",
      "not_ready_for_review",
      "files_incomplete",
      "labels_unknown",
      "behind_default_branch",
      "open_review_findings",
      "main_red",
    ]);
  });

  it("GivenNoOwnerApproval_WhenACleanPrTouchesAKeptPath_ThenItStillWaitsForAndy", () => {
    const v = mergeVerdict(
      clean({ files: { items: [file(".github/CODEOWNERS")], complete: true } }),
      "all-clean",
      { ownerApproval: false },
    );
    expect(v).toMatchObject({ verdict: "wait", reasons: ["kept_path"] });
  });

  it("GivenARequiredCheckFailedOnMainsHead_WhenACleanPrIsJudged_ThenItWaitsWithMainRedNamingTheCheck", () => {
    const v = mergeVerdict(
      clean({ mainChecks: { state: "failed", failing: ["ci"] } }),
      "all-clean",
    );
    expect(v).toMatchObject({ verdict: "wait", reasons: ["main_red"], mainRedChecks: ["ci"] });
  });

  it("GivenMainsChecksStillRunning_WhenACleanPrIsJudged_ThenItMerges", () => {
    const v = mergeVerdict(clean({ mainChecks: { state: "running", failing: [] } }), "all-clean");
    expect(v).toMatchObject({ verdict: "merge", reasons: [], mainRedChecks: [] });
  });

  it("GivenMainsChecksUnread_WhenACleanPrIsJudged_ThenItWaitsNeverCountedGreen", () => {
    expect(mergeVerdict(clean({ mainChecks: null }), "all-clean")).toMatchObject({
      verdict: "wait",
      reasons: ["main_checks_unknown"],
    });
  });

  it.each<[MergeMode, "merge" | "wait"]>([
    ["all-clean", "merge"],
    ["low-risk", "merge"],
    ["epic", "wait"],
    ["manual", "wait"],
  ])("GivenACleanPlainPr_WhenTheModeIs %s_ThenIt %ss", (mode, verdict) => {
    expect(mergeVerdict(clean(), mode).verdict).toBe(verdict);
  });

  it("GivenNoModeSaved_WhenACleanPrIsJudged_ThenItWaits", () => {
    expect(mergeVerdict(clean(), null)).toMatchObject({
      verdict: "wait",
      reasons: ["mode_not_set"],
    });
  });

  it.each<MergeMode>(["all-clean", "low-risk"])(
    "GivenAKeptPath_WhenTheModeIs %s_ThenItWaits",
    (mode) => {
      const v = mergeVerdict(
        clean({ files: { items: [file(".github/workflows/ci.yml")], complete: true } }),
        mode,
      );
      expect(v.reasons).toContain("kept_path");
      expect(v.keptFiles).toEqual([".github/workflows/ci.yml"]);
    },
  );

  it("GivenAHighRiskPathThatIsNotKept_WhenLowRisk_ThenItWaitsAndAllCleanMerges", () => {
    const facts = clean({
      files: { items: [file("packages/contracts/src/entities/index.ts")], complete: true },
    });
    expect(mergeVerdict(facts, "low-risk")).toMatchObject({
      verdict: "wait",
      reasons: ["high_risk_path"],
    });
    expect(mergeVerdict(facts, "all-clean").verdict).toBe("merge");
  });

  it("GivenAFileRenamedOutOfAKeptPlace_WhenJudged_ThenTheOldNameStillCounts", () => {
    expect(keptFiles([file("tmp/ci.yml", ".github/workflows/ci.yml")])).toEqual([
      ".github/workflows/ci.yml",
    ]);
  });

  it("GivenEveryFactUnknownOrDirty_WhenJudged_ThenItWaitsWithEveryReason", () => {
    const v = mergeVerdict(
      clean({
        gateClean: false,
        files: { items: [], complete: false },
        labels: null,
        upToDate: null,
        openFindings: null,
        readyForReview: false,
      }),
      "all-clean",
    );
    expect(v.reasons).toEqual([
      "gate_not_clean",
      "not_ready_for_review",
      "files_incomplete",
      "labels_unknown",
      "up_to_date_unknown",
      "review_findings_unknown",
    ]);
  });

  it("GivenAnAcceptedLabelBehindMainAndAnOpenFinding_WhenJudged_ThenEachIsAReason", () => {
    const v = mergeVerdict(
      clean({ labels: ["review-accepted"], upToDate: false, openFindings: 2 }),
      "all-clean",
    );
    expect(v.reasons).toEqual(["accepted_label", "behind_default_branch", "open_review_findings"]);
  });
});

describe("path lists", () => {
  it("GivenADocsOnlyAdr_WhenChecked_ThenItIsHighRiskButNotInATicketsCodePr", () => {
    expect(highRiskFiles([file("docs/architecture/adr/0200-x.md")])).toEqual([
      "docs/architecture/adr/0200-x.md",
    ]);
    expect(
      highRiskFiles([file("docs/architecture/adr/0200-x.md"), file("apps/web/src/a.ts")]),
    ).toEqual([]);
  });

  it("GivenSecurityDocsInAnyPr_WhenChecked_ThenHighRisk", () => {
    expect(highRiskFiles([file("docs/security/x.md"), file("apps/web/src/a.ts")])).toEqual([
      "docs/security/x.md",
    ]);
  });

  it("GivenTheMergeRuleItself_WhenChecked_ThenItIsKept", () => {
    expect(
      keptFiles([
        file("packages/domain/src/merge-paths.ts"),
        file("platform/procedures/coordinate.md"),
      ]),
    ).toHaveLength(2);
  });
});

describe("openFindingsOn", () => {
  const f = (over: Partial<ReviewFinding>) =>
    ({
      repo: "a/b",
      pullNumber: 7,
      headSha: "abc1234",
      severity: "should-fix",
      ...over,
    }) as ReviewFinding;

  it("GivenFindingsOnSeveralHeads_WhenCounted_ThenOnlyThisHeadsOpenOnesCount", () => {
    const n = openFindingsOn(
      [
        f({}),
        f({ severity: "question" }),
        f({ headSha: "old1234" }),
        f({ pullNumber: 8 }),
        f({ repo: "c/d" }),
        f({ severity: "high" }),
      ],
      { repo: "a/b", number: 7, headSha: "abc1234" },
    );
    expect(n).toBe(2);
  });
});
