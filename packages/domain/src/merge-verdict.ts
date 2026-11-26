import type {
  ChangedFile,
  Listing,
  MergeMode,
  MergeWaitReason,
  ReviewFinding,
} from "@andy/contracts";
import { globToRegExp } from "./gate";
import { DOCS_ONLY_HIGH_RISK_PATHS, HIGH_RISK_PATHS, KEPT_PATHS } from "./merge-paths";

/**
 * The merge verdict (ADR-0124, AI-215): whether a PR merges without Andy under its project's
 * mode. One pure function over facts the code host reports: the gate's decision on the head,
 * changed paths, labels, whether the head contains the latest default branch, the review
 * findings recorded for the head, and the default branch's own required checks (AI-382: a red
 * main holds every merge into it). Never PR text: titles, descriptions and comments aren't inputs,
 * and changed paths are only matched against `merge-paths.ts`. A fact that couldn't be read is a
 * reason to wait (fail closed).
 */

/** Labels by which Andy accepts a review finding instead of a fix: his merge, never the gate's. */
export const ACCEPTED_LABELS: readonly string[] = ["review-accepted", "security-accepted"];

/**
 * Reasons that leave an otherwise clean PR for Andy (ADR-0124): his merge, not a wait or a fix.
 * The web app's Merge button waives exactly these (AI-388, ADR-0157).
 */
export const ANDYS_MERGE_REASONS: readonly MergeWaitReason[] = [
  "mode_not_set",
  "mode_manual",
  "mode_epic",
  "kept_path",
  "high_risk_path",
  "accepted_label",
];

/** Findings that keep a PR from being clean (ADR-0124 "Clean"). */
export const OPEN_FINDING_SEVERITIES: readonly ReviewFinding["severity"][] = [
  "blocker",
  "should-fix",
  "critical",
  "high",
];

/** The default branch's required checks on its head (AI-382, `mainChecksOf`). */
export interface MainChecks {
  state: "passed" | "running" | "failed";
  /** The required checks that failed; empty unless `failed`. */
  failing: string[];
}

export interface MergeFacts {
  /** The gate's decision on the head: every check and both reviews passed, no veto, not draft. */
  gateClean: boolean;
  files: Listing<ChangedFile>;
  /** The PR's labels; null when they couldn't be read. */
  labels: string[] | null;
  /** The head contains the default branch's latest commit; null when it couldn't be checked. */
  upToDate: boolean | null;
  /**
   * Open findings on this head: from a findings source (`openFindingsOn`), else 0, since the
   * review checks in `gateClean` fail on every open finding (ADR-0134). Null: a source's read
   * failed.
   */
  openFindings: number | null;
  /** The ticket is in Ready for review (the gate's existing rule). */
  readyForReview: boolean;
  /**
   * The default branch's own checks on its tip (AI-382, ADR-0154): `failed` holds every merge
   * into it; running counts as not red. Null: couldn't be read (wait).
   */
  mainChecks: MainChecks | null;
}

export interface MergeVerdict {
  verdict: "merge" | "wait";
  /** Empty exactly when `verdict` is `merge`. */
  reasons: MergeWaitReason[];
  /** Changed paths on the kept list, capped. */
  keptFiles: string[];
  /** Changed paths on the high-risk list, capped; checked in `low-risk` mode only. */
  highRiskFiles: string[];
  /** The default branch's failing required checks when `main_red`, capped; else empty. */
  mainRedChecks: string[];
}

const toRegExps = (globs: readonly string[]) => globs.map(globToRegExp);
const KEPT = toRegExps(KEPT_PATHS);
const HIGH_RISK = toRegExps(HIGH_RISK_PATHS);
const DOCS_ONLY_HIGH_RISK = toRegExps(DOCS_ONLY_HIGH_RISK_PATHS);

/** A rename counts under both names, so moving a file in or out of a listed place can't hide it. */
const pathsOf = (files: readonly ChangedFile[]) =>
  files.flatMap((f) => (f.previousPath ? [f.path, f.previousPath] : [f.path]));

const matching = (paths: string[], patterns: RegExp[]) => [
  ...new Set(paths.filter((p) => patterns.some((re) => re.test(p)))),
];

const cap = (paths: string[]) => paths.slice(0, 50).map((p) => p.slice(0, 300));

/** Changed paths on the kept list (ADR-0124 kept kinds). */
export function keptFiles(files: readonly ChangedFile[]): string[] {
  return matching(pathsOf(files), KEPT);
}

/** Changed paths on the high-risk list (ADR-0092), with the docs-only rows for docs-only PRs. */
export function highRiskFiles(files: readonly ChangedFile[]): string[] {
  const paths = pathsOf(files);
  const docsOnly = paths.length > 0 && paths.every((p) => p.startsWith("docs/"));
  return matching(paths, docsOnly ? [...HIGH_RISK, ...DOCS_ONLY_HIGH_RISK] : HIGH_RISK);
}

/** Open findings (`OPEN_FINDING_SEVERITIES`) recorded for exactly this repo, PR and head. */
export function openFindingsOn(
  findings: readonly Pick<ReviewFinding, "repo" | "pullNumber" | "headSha" | "severity">[],
  pr: { repo: string; number: number; headSha: string },
): number {
  return findings.filter(
    (f) =>
      f.repo === pr.repo &&
      f.pullNumber === pr.number &&
      f.headSha === pr.headSha &&
      OPEN_FINDING_SEVERITIES.includes(f.severity),
  ).length;
}

/**
 * `merge` only when the mode allows it and every fact is known and clean; otherwise `wait` with
 * every reason. A null mode is a project with no mode saved: nothing merges (ADR-0134). `epic`
 * merges stories into their epic's branch (AI-216), never here, so it waits too.
 */
export function mergeVerdict(
  facts: MergeFacts,
  mode: MergeMode | null,
  /**
   * AI-388 (ADR-0157): Andy's own ask from the web app. It waives exactly
   * `ANDYS_MERGE_REASONS` (the mode, kept and high-risk paths, his accepted label); every check,
   * review, finding, unknown fact and a red main still hold the PR.
   */
  options: { ownerApproval?: boolean } = {},
): MergeVerdict {
  const reasons: MergeWaitReason[] = [];
  if (mode === null) reasons.push("mode_not_set");
  else if (mode === "manual") reasons.push("mode_manual");
  else if (mode === "epic") reasons.push("mode_epic");

  if (!facts.gateClean) reasons.push("gate_not_clean");
  if (!facts.readyForReview) reasons.push("not_ready_for_review");
  if (!facts.files.complete) reasons.push("files_incomplete");
  const kept = keptFiles(facts.files.items);
  if (kept.length > 0) reasons.push("kept_path");
  const risky = mode === "low-risk" ? highRiskFiles(facts.files.items) : [];
  if (risky.length > 0) reasons.push("high_risk_path");

  if (facts.labels === null) reasons.push("labels_unknown");
  else if (facts.labels.some((l) => ACCEPTED_LABELS.includes(l))) reasons.push("accepted_label");
  if (facts.upToDate === null) reasons.push("up_to_date_unknown");
  else if (!facts.upToDate) reasons.push("behind_default_branch");
  if (facts.openFindings === null) reasons.push("review_findings_unknown");
  else if (facts.openFindings > 0) reasons.push("open_review_findings");
  if (facts.mainChecks === null) reasons.push("main_checks_unknown");
  else if (facts.mainChecks.state === "failed") reasons.push("main_red");

  const left = options.ownerApproval
    ? reasons.filter((r) => !ANDYS_MERGE_REASONS.includes(r))
    : reasons;
  return {
    verdict: left.length === 0 ? "merge" : "wait",
    reasons: left,
    keptFiles: cap(kept),
    highRiskFiles: cap(risky),
    mainRedChecks:
      facts.mainChecks?.state === "failed"
        ? facts.mainChecks.failing.slice(0, 20).map((c) => c.slice(0, 256))
        : [],
  };
}
