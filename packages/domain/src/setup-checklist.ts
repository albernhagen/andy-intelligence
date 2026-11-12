import type { Project } from "@andy/contracts";

/**
 * A project's setup checklist (AI-95: M5.15, from AI-65's closed list): five steps a project
 * needs before agents work it unattended. Pure: the API gathers the repo facts through the
 * `CodeHost` port and this decides each item. Nothing here does a step (out of scope).
 */

export const SETUP_ITEMS = {
  repo_connected: "Repo connected",
  baseline_merged: "Baseline merged",
  deploy_proven: "Deploy proven",
  threat_model_started: "Threat model started",
  budget_caps_set: "Budget caps set",
} as const;
export type SetupItemKey = keyof typeof SETUP_ITEMS;

/** `unknown`: the repo couldn't be read, so we can't say (never shown as done). */
export type SetupItemStatus = "done" | "missing" | "unknown" | "not_yet";

export interface SetupItem {
  key: SetupItemKey;
  label: string;
  status: SetupItemStatus;
  /** What's left, or why it's unknown; null when done. */
  detail: string | null;
}

export interface SetupChecklist {
  /** The repo checked: the project's first; null when it has none. */
  repo: string | null;
  /** Every item done: the project page hides the checklist. */
  complete: boolean;
  items: SetupItem[];
}

/**
 * The managed files of `platform/baseline/manifest.json` (ADR-0031, ADR-0038): all present on
 * the default branch means the baseline PR merged. A domain test keeps this list equal to the
 * manifest, so a new managed file fails CI until it is added here.
 */
export const BASELINE_FILES = [
  ".github/workflows/ci.yml",
  ".github/workflows/secret-scan.yml",
  ".github/workflows/security-scans.yml",
  ".github/workflows/security-review.yml",
  ".github/workflows/adversarial-review.yml",
  ".github/workflows/dependabot-auto-merge.yml",
  ".github/dependabot.yml",
  ".github/pull_request_template.md",
  ".prettierrc.json",
  "lefthook.yml",
  ".claude/settings.json",
  "scripts/format-edited-file.mjs",
] as const;

/** The seed file every managed repo starts its threat model in (ADR-0025). */
export const THREAT_MODEL_PATH = "docs/security/threat-model.md";

/**
 * Until M6: Dev → prod releases supplies a deploy fact. Budget caps read the same while the
 * project has no `monthlyBudgetUsd`: nothing sets it yet, and ADR-0028's per-project budgets
 * come with the deploy scaffold.
 */
export const NOT_YET_M6 = "not yet (M6: Dev → prod releases)";

/** What the API could learn about the project's first repo. */
export type RepoFacts =
  | { kind: "read"; repo: string; missingBaselineFiles: string[]; threatModel: boolean }
  | { kind: "no_repo" }
  | { kind: "not_installed"; repo: string }
  | { kind: "error"; repo: string; error: string };

/** How many missing baseline files the detail names before "and N more". */
const NAMED_FILES = 3;

export function setupChecklist(
  project: Pick<Project, "repos" | "monthlyBudgetUsd">,
  facts: RepoFacts,
  deployProven = false,
): SetupChecklist {
  const items: SetupItem[] = [
    item("repo_connected", repoConnected(facts)),
    item("baseline_merged", repoFile(facts, baselineMerged)),
    item(
      "deploy_proven",
      deployProven ? { status: "done", detail: null } : { status: "not_yet", detail: NOT_YET_M6 },
    ),
    item(
      "threat_model_started",
      repoFile(facts, (f) =>
        f.threatModel
          ? { status: "done", detail: null }
          : { status: "missing", detail: `no ${THREAT_MODEL_PATH} on the default branch` },
      ),
    ),
    item(
      "budget_caps_set",
      project.monthlyBudgetUsd === null
        ? { status: "not_yet", detail: NOT_YET_M6 }
        : { status: "done", detail: null },
    ),
  ];
  return {
    repo: facts.kind === "no_repo" ? null : facts.repo,
    complete: items.every((i) => i.status === "done"),
    items,
  };
}

type Verdict = Pick<SetupItem, "status" | "detail">;

function item(key: SetupItemKey, verdict: Verdict): SetupItem {
  return { key, label: SETUP_ITEMS[key], ...verdict };
}

function repoConnected(facts: RepoFacts): Verdict {
  switch (facts.kind) {
    case "read":
      return { status: "done", detail: null };
    case "no_repo":
      return { status: "missing", detail: "no repo registered on this project" };
    case "not_installed":
      return {
        status: "missing",
        detail: `the GitHub App isn't connected or installed on ${facts.repo}`,
      };
    case "error":
      return { status: "unknown", detail: `couldn't read ${facts.repo}: ${facts.error}` };
  }
}

/** Items read from the repo: unknown, never done, when it couldn't be read. */
function repoFile(
  facts: RepoFacts,
  decide: (f: Extract<RepoFacts, { kind: "read" }>) => Verdict,
): Verdict {
  switch (facts.kind) {
    case "read":
      return decide(facts);
    case "no_repo":
      return { status: "unknown", detail: "no repo to read" };
    case "not_installed":
      return { status: "unknown", detail: `can't read ${facts.repo}: the App isn't installed` };
    case "error":
      return { status: "unknown", detail: `couldn't read ${facts.repo}: ${facts.error}` };
  }
}

function baselineMerged(facts: Extract<RepoFacts, { kind: "read" }>): Verdict {
  const missing = facts.missingBaselineFiles;
  if (missing.length === 0) return { status: "done", detail: null };
  const named = missing.slice(0, NAMED_FILES).join(", ");
  const more = missing.length > NAMED_FILES ? ` and ${missing.length - NAMED_FILES} more` : "";
  return { status: "missing", detail: `missing ${named}${more}` };
}
