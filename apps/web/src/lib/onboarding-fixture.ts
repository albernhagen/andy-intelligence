import type { Onboarding, OnboardingStatus, OnboardingStepKey } from "@andy/contracts";

/**
 * Test data (unit tests and the e2e fake API): an onboarding answer as `GET …/onboarding` gives
 * it, every step with the given status (default done). Not imported by the app.
 */

const REPO = "albernhagen/widgets";
const gh = (path: string) => `https://github.com/${REPO}${path}`;
const cmd = (c: string) => `node platform/baseline/baseline.mjs ${c}`;

type Base = Omit<Onboarding["steps"][number], "status" | "marked" | "checks">;

const BASE: Record<OnboardingStepKey, Base> = {
  repo_app: {
    key: "repo_app",
    label: "Repo and GitHub App",
    instruction:
      "Create the repo (a new, empty one: run onboard now), then install the GitHub App on it.",
    commands: [
      { label: "Create the repo", text: `gh repo create ${REPO} --public` },
      { label: "Onboard a new repo", text: cmd(`onboard ${REPO} --ref v1.0.0`) },
    ],
    link: {
      label: "Install the GitHub App",
      url: "https://github.com/apps/andy-ai/installations/new",
    },
    how: "live",
  },
  baseline_pr: {
    key: "baseline_pr",
    label: "Finish the baseline PR",
    instruction:
      "Run the baseline PR's finish command (its description has the line with the sha), review, merge.",
    commands: [
      {
        label: "Add what the App left out",
        text: cmd(`finish ${REPO} --ref <sha> --branch baseline/<sha7>`),
      },
    ],
    link: { label: "Open the repo's pull requests", url: gh("/pulls") },
    how: "live",
  },
  repo_settings: {
    key: "repo_settings",
    label: "Apply the repo settings",
    instruction: "After the baseline PR merges: preview, apply, then check the repo settings.",
    commands: [
      { label: "Preview", text: cmd(`apply ${REPO} --dry-run`) },
      { label: "Apply", text: cmd(`apply ${REPO}`) },
      { label: "Check (exit 0)", text: cmd(`check ${REPO}`) },
    ],
    link: { label: "Open the repo's rulesets", url: gh("/settings/rules") },
    how: "live",
  },
  deploy_env: {
    key: "deploy_env",
    label: "Apply the deploy environments",
    instruction: "Nothing to apply: this project doesn't deploy (deploy kind none).",
    commands: [],
    link: null,
    how: "live",
  },
  reusable_workflows: {
    key: "reusable_workflows",
    label: "Allow reusable workflows",
    instruction:
      "Actions → General: Allow all actions and reusable workflows; Workflow permissions: Read repository contents.",
    commands: [],
    link: { label: "Open Actions settings", url: gh("/settings/actions") },
    how: "hand",
  },
  reviewer_token: {
    key: "reviewer_token",
    label: "Reviewer token",
    instruction:
      "Add a Claude token as repo secret CLAUDE_CODE_OAUTH_TOKEN; the review agents read it. Never paste it into chat.",
    commands: [
      { label: "Make a token", text: "claude setup-token" },
      {
        label: "Store it as a repo secret",
        text: `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${REPO}`,
      },
    ],
    link: { label: "Open Actions secrets", url: gh("/settings/secrets/actions") },
    how: "hand",
  },
  agent_environment: {
    key: "agent_environment",
    label: "Agent environment",
    instruction:
      "Environment agent, deployment branch main only, with its own CLAUDE_CODE_OAUTH_TOKEN (a new token).",
    commands: [{ label: "Make a token", text: "claude setup-token" }],
    link: { label: "Open environments", url: gh("/settings/environments") },
    how: "both",
  },
  proving_refine: {
    key: "proving_refine",
    label: "Prove one refine",
    instruction:
      "Run one refine: its Actions run's agent job shows environment agent and Check the model credential passes.",
    commands: [],
    link: null,
    how: "live",
  },
  builds_on: {
    key: "builds_on",
    label: "Turn builds on",
    instruction: "Turn Builds on in the project's settings (in the app only).",
    commands: [],
    link: null,
    how: "live",
  },
};

const CHECKS: Partial<Record<OnboardingStepKey, string[]>> = {
  repo_app: ["Project has a repo", "GitHub App installed on the repo"],
  baseline_pr: ["agent-run.yml on main", "Every baseline file on main"],
  repo_settings: ["Ruleset protect-main active"],
  deploy_env: ["Deploy kind none"],
  agent_environment: ["Environment agent exists", "Deployment branches: main only"],
  proving_refine: ["A refine task succeeded"],
  builds_on: ["Builds on"],
};

export function onboardingFixture(
  statuses: Partial<Record<OnboardingStepKey, OnboardingStatus>> = {},
  opts: { marked?: OnboardingStepKey[]; failingLimits?: boolean } = {},
): Onboarding {
  const steps = (Object.keys(BASE) as OnboardingStepKey[]).map((key) => {
    const status = statuses[key] ?? "done";
    const marked = opts.marked?.includes(key)
      ? { by: "andy@example.com", at: "2026-11-25T12:00:00.000Z" }
      : null;
    const checkStatus: OnboardingStatus =
      status === "done" || BASE[key].how === "hand" ? "done" : status;
    return {
      ...BASE[key],
      status,
      marked,
      checks: (CHECKS[key] ?? []).map((label) => ({
        label,
        status: checkStatus,
        detail:
          checkStatus === "done"
            ? null
            : checkStatus === "unknown"
              ? "the GitHub App may not read rulesets"
              : "not done yet",
      })),
    };
  });
  const fails = opts.failingLimits === true;
  return {
    repo: REPO,
    limits: [
      { key: "public", label: "Public", status: "ok", detail: null },
      fails
        ? {
            key: "main",
            label: "Default branch main",
            status: "fails",
            detail: "the default branch is master: rename it to main",
          }
        : { key: "main", label: "Default branch main", status: "ok", detail: null },
      fails
        ? {
            key: "pnpm_lock",
            label: "pnpm-lock.yaml",
            status: "fails",
            detail: "no pnpm-lock.yaml at the root: build agents can't install or run the checks",
          }
        : { key: "pnpm_lock", label: "pnpm-lock.yaml", status: "ok", detail: null },
      { key: "nvmrc", label: ".nvmrc", status: "ok", detail: null },
      { key: "one_repo", label: "The project's only repo", status: "ok", detail: null },
    ],
    steps,
    refine: {
      runId: null,
      ticketKey: null,
      status: statuses.proving_refine === "done" || !statuses.proving_refine ? "succeeded" : "none",
      url: null,
      error: null,
      candidate: null,
    },
    complete: steps.every((s) => s.status === "done"),
    readAt: "2026-11-25T12:00:00.000Z",
  };
}
