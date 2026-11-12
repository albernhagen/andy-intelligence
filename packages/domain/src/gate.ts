import type {
  AutoMerge,
  ChangedFile,
  GateReason,
  HeadCheck,
  Listing,
  RequiredCheck,
  Run,
  Size,
  TicketType,
} from "@andy/contracts";

/**
 * The review gate's rules (workflow.md §4.5, ADR-0050): pure functions over facts the host reports.
 * PR titles, descriptions and comments are never an input: the only PR-supplied strings here are
 * changed paths, and those are only matched against the lists below.
 */

/** Tooling and dependency files. Copy of `TOOLING_GLOBS` in scripts/executor-publish.mjs. */
export const TOOLING_GLOBS = [
  "**/package.json",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/.npmrc",
  "**/.yarnrc*",
  "**/pnpm-workspace.yaml",
  "**/lefthook.yml",
  "**/.lefthook.yml",
  "**/.gitattributes",
  "**/.nvmrc",
  "**/.node-version",
  "**/tsconfig*.json",
  "**/*.config.{js,cjs,mjs,ts,cts,mts,json}",
  "**/.prettierrc*",
  "**/.eslintrc*",
  "**/Makefile",
  "**/Dockerfile",
];

/**
 * Paths that always go to Andy, whatever a repo's CODEOWNERS says: CI and the credential-holding
 * scripts, infrastructure, agent rules, the gate itself, and auth, permission, payment and
 * migration code by its usual names.
 */
export const PROTECTED_GLOBS = [
  // CI, deploy, infrastructure and the scripts that hold credentials.
  "**/.github/**",
  "**/CODEOWNERS",
  "platform/**",
  "scripts/**",
  "infra/**",
  ".terraform-version",
  // Config that runs commands on Andy's machine or steers agents.
  ".mcp.json",
  "**/.claude/**",
  "**/.vscode/**",
  "**/.devcontainer/**",
  "**/.husky/**",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "docs/BUILD-PROMPT.md",
  "docs/security/**",
  "docs/architecture/adr/**",
  "context-budget.json",
  // Data rules and the schemas the executor reads.
  "**/firestore.rules",
  "packages/store/src/index.ts",
  "packages/contracts/**",
  // The gate, the dispatchers, the code host and the API's entry points and setters.
  "apps/api/src/github/**",
  "apps/api/src/app.ts",
  "apps/api/src/mcp/**",
  "packages/github/**",
  "packages/domain/src/gate*",
  "packages/domain/src/*-dispatch*",
  "packages/domain/src/projects*",
  // Auth, permission, payment and migration code by its usual names, as files or directories.
  "**/auth/**",
  "**/auth.*",
  "**/authn*",
  "**/authn*/**",
  "**/authz*",
  "**/authz*/**",
  "**/oauth*",
  "**/oauth*/**",
  "**/permission*",
  "**/permission*/**",
  "**/payment*",
  "**/payment*/**",
  "**/migration*",
  "**/migration*/**",
  "**/*.sql",
];

/** Where the code host looks for CODEOWNERS. */
export const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

/** The review agents' check runs: required on every PR, even if the branch rules omit them. */
export const REVIEW_CHECKS = ["adversarial-review", "security-review"];

/** Reasons that won't clear by waiting: the ticket is flagged for Andy. */
const FLAGGED_REASONS: readonly GateReason[] = [
  "no_verification_output",
  "protected_path",
  "files_incomplete",
  "spike_outside_docs",
];

/** The one directory a spike's PR may change (AI-99). */
export const SPIKE_DIR = "docs/";

const MAX_CODEOWNERS_LINES = 1000;

function expandBraces(glob: string): string[] {
  const open = glob.indexOf("{");
  const close = glob.indexOf("}", open);
  if (open < 0 || close < 0) return [glob];
  const [before, after] = [glob.slice(0, open), glob.slice(close + 1)];
  return glob
    .slice(open + 1, close)
    .split(",")
    .map((alt) => `${before}${alt}${after}`);
}

/** `*` within a segment, `**` across them, `**\/` for any leading directories. Case-insensitive. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        out += "(?:.*/)?";
      } else {
        out += ".*";
      }
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`, "i");
}

/**
 * Globs for a CODEOWNERS file's patterns, except the catch-all `*`, which only requests review
 * (ADR-0063, §4.5). A pattern may name a file or a directory, so both are matched.
 */
export function codeownersGlobs(text: string): string[] {
  const globs: string[] = [];
  for (const raw of text.split(/\r?\n/).slice(0, MAX_CODEOWNERS_LINES)) {
    const pattern = raw.trim().split(/\s+/, 1)[0] ?? "";
    if (!pattern || pattern.startsWith("#") || pattern === "*") continue;
    const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
    const path = pattern.replace(/^\//, "").replace(/\/$/, "");
    const base = anchored ? path : `**/${path}`;
    globs.push(base, `${base}/**`);
  }
  return globs;
}

/**
 * Changed paths that are protected. A rename counts under both its names, so moving a file out
 * of a protected directory, or into one, can't hide it.
 */
export function protectedFiles(files: ChangedFile[], extraGlobs: string[]): string[] {
  const patterns = [...PROTECTED_GLOBS, ...TOOLING_GLOBS, ...extraGlobs]
    .flatMap(expandBraces)
    .map(globToRegExp);
  const paths = files.flatMap((f) => (f.previousPath ? [f.path, f.previousPath] : [f.path]));
  return [...new Set(paths.filter((p) => patterns.some((re) => re.test(p))))];
}

/**
 * Changed paths outside `docs/`, for a spike (AI-99). A rename counts under both names, so a
 * file moved out of `docs/` into product code is caught.
 */
export function outsideDocs(files: ChangedFile[]): string[] {
  const paths = files.flatMap((f) => (f.previousPath ? [f.path, f.previousPath] : [f.path]));
  return [...new Set(paths.filter((p) => !p.toLowerCase().startsWith(SPIKE_DIR)))];
}

/** Whether the project's policy lets the control plane merge a ticket of this size. */
export function policyAllows(policy: AutoMerge, size: Size | null): boolean {
  if (!size) return false;
  switch (policy) {
    case "none":
      return false;
    case "s":
      return size === "S";
    case "s-and-m":
      return size === "S" || size === "M";
    case "all":
      return true;
  }
}

export interface GateFacts {
  verification: Run["verification"];
  draft: boolean;
  intoDefaultBranch: boolean;
  files: Listing<ChangedFile>;
  /** From the base branch's CODEOWNERS, never the PR's own copy. */
  codeowners: string[];
  required: RequiredCheck[];
  checks: Listing<HeadCheck>;
  /** A sync run is queued or running for the PR (AI-72): its head is about to change. */
  syncPending?: boolean;
  /** The ticket's type: a spike may change only `docs/` (AI-99). */
  ticketType?: TicketType | null;
}

export interface GateDecision {
  wouldAutoMerge: boolean;
  /** Empty exactly when `wouldAutoMerge`. */
  reasons: GateReason[];
  protectedFiles: string[];
  /** A spike's changed paths outside `docs/` (AI-99); empty for other types. */
  outsideDocs: string[];
  /** Whether Andy should be told now. */
  flag: boolean;
  /** A required non-review check has failed on this commit. */
  ciFailed: boolean;
  /** Review checks with a `failure` conclusion on this commit. */
  failedReviews: string[];
}

const hostPasses = (c: HeadCheck) =>
  c.status === "completed" && ["success", "neutral", "skipped"].includes(c.conclusion ?? "");

/** A review agent that errored reports `neutral` for Andy to decide (ADR-0025): not a pass. */
const reviewPasses = (c: HeadCheck) => c.status === "completed" && c.conclusion === "success";

function assessChecks(required: RequiredCheck[], checks: Listing<HeadCheck>) {
  const reasons: GateReason[] = [];
  if (!checks.complete) reasons.push("checks_incomplete");
  if (required.length === 0) reasons.push("no_required_checks");
  // A review check must come from the reporter the branch rules trust; none known means no pass.
  const reporter = required.find((r) => r.sourceId !== null)?.sourceId ?? null;
  const wanted: RequiredCheck[] = [
    ...required.filter((r) => !REVIEW_CHECKS.includes(r.name)),
    ...REVIEW_CHECKS.map((name) => ({
      name,
      sourceId: required.find((r) => r.name === name)?.sourceId ?? reporter,
    })),
  ];
  let failing = false;
  let pending = false;
  let ciFailed = false;
  const failedReviews: string[] = [];
  for (const want of wanted) {
    const isReview = REVIEW_CHECKS.includes(want.name);
    const passes = isReview ? reviewPasses : hostPasses;
    // A check of the right name from another reporter doesn't count; it can't be trusted to run.
    const found = checks.items.filter(
      (c) =>
        c.name === want.name &&
        (isReview
          ? c.sourceId === want.sourceId && c.sourceId !== null
          : want.sourceId === null || c.sourceId === want.sourceId),
    );
    if (found.length === 0 || found.some((c) => c.status !== "completed")) {
      pending = true;
      continue;
    }
    if (found.every(passes)) continue;
    failing = true;
    if (!isReview) ciFailed = true;
    else if (found.some((c) => c.conclusion === "failure")) failedReviews.push(want.name);
  }
  if (failing) reasons.push("checks_failed");
  if (pending) reasons.push("checks_pending");
  return { reasons, ciFailed, failedReviews };
}

/**
 * What the gate says about a PR's current head. `verification` is the agent's own report, so it
 * is an advisory signal (a report with no output is a veto); CI and the reviews are the proof.
 * Missing information never counts as a pass.
 */
export function decideGate(facts: GateFacts): GateDecision {
  const reasons: GateReason[] = [];
  if (facts.verification.length === 0 || facts.verification.some((c) => !c.output.trim())) {
    reasons.push("no_verification_output");
  }
  const hits = protectedFiles(facts.files.items, facts.codeowners);
  if (hits.length > 0) reasons.push("protected_path");
  if (!facts.files.complete) reasons.push("files_incomplete");
  if (facts.draft) reasons.push("draft");
  if (!facts.intoDefaultBranch) reasons.push("not_default_branch");
  if (facts.syncPending) reasons.push("sync_pending");
  const stray = facts.ticketType === "spike" ? outsideDocs(facts.files.items) : [];
  if (stray.length > 0) reasons.push("spike_outside_docs");
  const checks = assessChecks(facts.required, facts.checks);
  reasons.push(...checks.reasons);
  return {
    wouldAutoMerge: reasons.length === 0,
    reasons,
    protectedFiles: hits.slice(0, 50).map((p) => p.slice(0, 300)),
    outsideDocs: stray.slice(0, 50).map((p) => p.slice(0, 300)),
    flag: reasons.some((r) => FLAGGED_REASONS.includes(r)),
    ciFailed: checks.ciFailed,
    failedReviews: checks.failedReviews,
  };
}
