import type {
  DeployKind,
  MarkableStepKey,
  Onboarding,
  OnboardingCheck,
  OnboardingCommand,
  OnboardingHow,
  OnboardingMarks,
  OnboardingStatus,
  OnboardingStep,
  OnboardingStepKey,
  ProvingRefine,
  RepoLimit,
} from "@andy/contracts";
import { BASELINE_FILES } from "./setup-checklist";

/**
 * Onboarding a managed repo (AI-381): every step of runbook `managed-project.md`, each with its
 * one-line instruction, its exact commands (the project's repo filled in), the page where it is
 * done, and a status. Pure: the API reads the facts through the `CodeHost` port and this decides.
 * The runbook stays the source; a test checks every command here is written there. Nothing here
 * runs a step, and no token value is read or shown: steps whose result can't be read are marked
 * done by hand.
 */

/** The workflow a managed repo calls the executor from (ADR-0096). */
export const AGENT_RUN_WORKFLOW = ".github/workflows/agent-run.yml";
/** The ruleset `apply` sets on `main`. */
export const PROTECT_MAIN_RULESET = "protect-main";
/** The environment agent tasks read their token from (runbook agent-environment.md). */
export const AGENT_ENVIRONMENT = "agent";
/** The baseline tag new repos are onboarded at (runbook onboard-a-repo.md §3). */
export const ONBOARD_REF = "v1.0.0";

/** Folders the API lists (one read each, ADR-0028): the limits' files and the baseline's. */
export const ONBOARDING_DIRS = ["", ".github", ".github/workflows", ".claude", "scripts"] as const;
export type OnboardingDir = (typeof ONBOARDING_DIRS)[number];

/** A setting read that can fail without making the step "not yet". */
export type SettingFact<T> = { kind: "read"; value: T } | { kind: "unknown"; error: string };

/** What the API could learn about the project's first repo. */
export type OnboardingRepoFacts =
  | { kind: "no_repo" }
  | { kind: "not_installed"; repo: string }
  | { kind: "error"; repo: string; error: string }
  | {
      kind: "read";
      repo: string;
      private: boolean;
      defaultBranch: string;
      /** File names directly in each folder of `ONBOARDING_DIRS`; null when it is missing. */
      files: Partial<Record<OnboardingDir, string[] | null>>;
      /** Ruleset `protect-main` is active. */
      ruleset: SettingFact<boolean>;
      environment: SettingFact<{ exists: boolean; mainOnly: boolean }>;
    };

export interface OnboardingFacts {
  repoCount: number;
  repo: OnboardingRepoFacts;
  /** Where Andy installs the App on repos; null when the App isn't connected. */
  appInstallUrl: string | null;
  refine: ProvingRefine;
  buildEnabled: boolean;
  /** The project's deploy kind (ADR-0114): `none` has no deploy environments to apply. */
  deployKind: DeployKind;
  marks: OnboardingMarks;
  readAt: string;
}

export const ONBOARDING_LABELS: Record<OnboardingStepKey, string> = {
  repo_app: "Repo and GitHub App",
  baseline_pr: "Finish the baseline PR",
  repo_settings: "Apply the repo settings",
  deploy_env: "Apply the deploy environments",
  reusable_workflows: "Allow reusable workflows",
  reviewer_token: "Reviewer token",
  agent_environment: "Agent environment",
  proving_refine: "Prove one refine",
  builds_on: "Turn builds on",
};

const MARKABLE: ReadonlySet<OnboardingStepKey> = new Set<MarkableStepKey>([
  "repo_app",
  "baseline_pr",
  "repo_settings",
  "deploy_env",
  "reusable_workflows",
  "reviewer_token",
  "agent_environment",
  "proving_refine",
]);

export function isMarkable(key: OnboardingStepKey): key is MarkableStepKey {
  return MARKABLE.has(key);
}

const baseline = (cmd: string) => `node platform/baseline/baseline.mjs ${cmd}`;
const done = (label: string): OnboardingCheck => ({ label, status: "done", detail: null });
const check = (label: string, ok: boolean, detail: string): OnboardingCheck =>
  ok ? done(label) : { label, status: "not_yet", detail };
const unknown = (label: string, detail: string): OnboardingCheck => ({
  label,
  status: "unknown",
  detail,
});

/** The repo in commands: the project's, or a placeholder before it has one. */
function repoName(facts: OnboardingRepoFacts): string {
  return facts.kind === "no_repo" ? "<owner>/<name>" : facts.repo;
}

/** Why a check on the repo can't be read yet, or null when the repo was read. */
function unreadable(facts: OnboardingRepoFacts): string | null {
  switch (facts.kind) {
    case "read":
      return null;
    case "no_repo":
      return "the project has no repo";
    case "not_installed":
      return "the GitHub App can't see the repo: install it first";
    case "error":
      return `couldn't read the repo: ${facts.error}`;
  }
}

/** The limits a managed repo must meet (runbook "Limits"), each ok, failing or unknown. */
export function repoLimits(facts: OnboardingRepoFacts, repoCount: number): RepoLimit[] {
  const why = unreadable(facts);
  const limit = (
    key: RepoLimit["key"],
    label: string,
    ok: (f: Extract<OnboardingRepoFacts, { kind: "read" }>) => boolean,
    fails: string,
  ): RepoLimit => {
    if (facts.kind !== "read") return { key, label, status: "unknown", detail: why };
    return ok(facts)
      ? { key, label, status: "ok", detail: null }
      : { key, label, status: "fails", detail: fails };
  };
  const root = (f: Extract<OnboardingRepoFacts, { kind: "read" }>) => f.files[""] ?? [];
  return [
    limit(
      "public",
      "Public",
      (f) => !f.private,
      "the repo is private: GitHub Free gives it no rulesets or environments",
    ),
    limit(
      "main",
      "Default branch main",
      (f) => f.defaultBranch === "main",
      `the default branch is ${facts.kind === "read" ? facts.defaultBranch : "?"}: rename it to main`,
    ),
    limit(
      "pnpm_lock",
      "pnpm-lock.yaml",
      (f) => root(f).includes("pnpm-lock.yaml"),
      "no pnpm-lock.yaml at the root: build agents can't install or run the checks",
    ),
    limit(
      "nvmrc",
      ".nvmrc",
      (f) => root(f).includes(".nvmrc"),
      "no .nvmrc at the root: the executor installs Node only when it exists",
    ),
    repoCount <= 1
      ? { key: "one_repo", label: "The project's only repo", status: "ok", detail: null }
      : {
          key: "one_repo",
          label: "The project's only repo",
          status: "fails",
          detail: `the project has ${repoCount} repos; agent tasks run in the first only`,
        },
  ];
}

/** Baseline files not on the default branch, from the folder listings. */
export function missingBaselineFiles(
  files: Partial<Record<OnboardingDir, string[] | null>>,
): string[] {
  return BASELINE_FILES.filter((path) => {
    const cut = path.lastIndexOf("/");
    const dir = (cut < 0 ? "" : path.slice(0, cut)) as OnboardingDir;
    return !(files[dir] ?? []).includes(path.slice(cut + 1));
  });
}

type StepSpec = Omit<OnboardingStep, "status" | "marked" | "label">;

function specs(f: OnboardingFacts): Record<OnboardingStepKey, StepSpec> {
  const repo = repoName(f.repo);
  const gh = (path: string) =>
    f.repo.kind === "no_repo" ? null : `https://github.com/${repo}${path}`;
  const link = (label: string, url: string | null) => (url ? { label, url } : null);
  const why = unreadable(f.repo);
  const r = f.repo.kind === "read" ? f.repo : null;

  const repoChecks: OnboardingCheck[] = [
    f.repo.kind === "no_repo"
      ? { label: "Project has a repo", status: "not_yet", detail: "add the repo in settings" }
      : done("Project has a repo"),
    f.repo.kind === "read"
      ? done("GitHub App installed on the repo")
      : f.repo.kind === "error"
        ? unknown("GitHub App installed on the repo", why!)
        : {
            label: "GitHub App installed on the repo",
            status: "not_yet",
            detail: "install the App on the repo",
          },
  ];

  const missing = r ? missingBaselineFiles(r.files) : [];
  const baselineChecks: OnboardingCheck[] = r
    ? [
        check(
          "agent-run.yml on main",
          !missing.includes(AGENT_RUN_WORKFLOW),
          "run the PR's finish command, then merge",
        ),
        check(
          "Every baseline file on main",
          missing.length === 0,
          `missing: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}`,
        ),
      ]
    : [unknown("Baseline PR merged", why!)];

  const rulesetCheck: OnboardingCheck = !r
    ? unknown(`Ruleset ${PROTECT_MAIN_RULESET} active`, why!)
    : r.ruleset.kind === "unknown"
      ? unknown(`Ruleset ${PROTECT_MAIN_RULESET} active`, r.ruleset.error)
      : check(
          `Ruleset ${PROTECT_MAIN_RULESET} active`,
          r.ruleset.value,
          "run apply after the baseline PR merges",
        );

  const envChecks: OnboardingCheck[] = !r
    ? [unknown(`Environment ${AGENT_ENVIRONMENT}, main only`, why!)]
    : r.environment.kind === "unknown"
      ? [unknown(`Environment ${AGENT_ENVIRONMENT}, main only`, r.environment.error)]
      : [
          check(
            `Environment ${AGENT_ENVIRONMENT} exists`,
            r.environment.value.exists,
            "New environment → agent",
          ),
          check(
            "Deployment branches: main only",
            r.environment.value.exists && r.environment.value.mainOnly,
            "Selected branches and tags → add rule main",
          ),
        ];

  const refine = f.refine;
  const refineCheck: OnboardingCheck =
    refine.status === "succeeded"
      ? done(`Refine succeeded${refine.ticketKey ? ` on ${refine.ticketKey}` : ""}`)
      : refine.status === "unknown"
        ? {
            label: "A refine task succeeded",
            status: "unknown",
            detail: `more tasks ended than the app reads${refine.error ? ` (the newest refine seen failed: ${refine.error})` : ""}: mark this done if a refine passed`,
          }
        : {
            label: "A refine task succeeded",
            status: "not_yet",
            detail:
              refine.status === "running"
                ? "a refine task is running"
                : refine.status === "failed"
                  ? `the last refine failed${refine.error ? `: ${refine.error}` : ""}`
                  : "no refine has run in this project yet",
          };

  return {
    repo_app: {
      key: "repo_app",
      instruction:
        "Create the repo (a new, empty one: run onboard now), then install the GitHub App on it.",
      commands: [
        { label: "Create the repo", text: `gh repo create ${repo} --public` },
        { label: "Onboard a new repo", text: baseline(`onboard ${repo} --ref ${ONBOARD_REF}`) },
      ],
      link: link("Install the GitHub App", f.appInstallUrl),
      how: "live",
      checks: repoChecks,
    },
    baseline_pr: {
      key: "baseline_pr",
      instruction:
        "Run the baseline PR's finish command (its description has the line with the sha), review, merge.",
      commands: [
        {
          label: "Add what the App left out",
          text: baseline(`finish ${repo} --ref <sha> --branch baseline/<sha7>`),
        },
      ],
      link: link("Open the repo's pull requests", gh("/pulls")),
      how: "live",
      checks: baselineChecks,
    },
    repo_settings: {
      key: "repo_settings",
      instruction: "After the baseline PR merges: preview, apply, then check the repo settings.",
      commands: [
        { label: "Preview", text: baseline(`apply ${repo} --dry-run`) },
        { label: "Apply", text: baseline(`apply ${repo}`) },
        { label: "Check (exit 0)", text: baseline(`check ${repo}`) },
      ],
      link: link("Open the repo's rulesets", gh("/settings/rules")),
      how: "live",
      checks: [rulesetCheck],
    },
    deploy_env: deployEnvStep(
      f.deployKind,
      repo,
      link("Open Actions variables", gh("/settings/variables/actions")),
    ),
    reusable_workflows: {
      key: "reusable_workflows",
      instruction:
        "Actions → General: Allow all actions and reusable workflows; Workflow permissions: Read repository contents.",
      commands: [],
      link: link("Open Actions settings", gh("/settings/actions")),
      how: "hand",
      checks: [],
    },
    reviewer_token: {
      key: "reviewer_token",
      instruction:
        "Add a Claude token as repo secret CLAUDE_CODE_OAUTH_TOKEN; the review agents read it. Never paste it into chat.",
      commands: [
        { label: "Make a token", text: "claude setup-token" },
        {
          label: "Store it as a repo secret",
          text: `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${repo}`,
        },
      ],
      link: link("Open Actions secrets", gh("/settings/secrets/actions")),
      how: "hand",
      checks: [],
    },
    agent_environment: {
      key: "agent_environment",
      instruction:
        "Environment agent, deployment branch main only, with its own CLAUDE_CODE_OAUTH_TOKEN (a new token).",
      commands: [{ label: "Make a token", text: "claude setup-token" }],
      link: link("Open environments", gh("/settings/environments")),
      how: "both",
      checks: envChecks,
    },
    proving_refine: {
      key: "proving_refine",
      instruction:
        "Run one refine: its Actions run's agent job shows environment agent and Check the model credential passes.",
      commands: [],
      link: link("Open the refine's run", refine.url),
      how: "live",
      checks: [refineCheck],
    },
    builds_on: {
      key: "builds_on",
      instruction: "Turn Builds on in the project's settings (in the app only).",
      commands: [],
      link: null,
      how: "live",
      checks: [check("Builds on", f.buildEnabled, "turn Builds on in project settings")],
    },
  };
}

/** The state bucket the template Terraform root's `gcs` backend uses (runbook project-env.md). */
const STATE_BUCKET = "gs://<prod project>-tfstate";

/**
 * Applying the template Terraform root the baseline PR seeds in `infra/` (AI-109: M6.22), then
 * setting the repo variables from its output. Commands run in a clone of the project's repo. A
 * project that doesn't deploy has nothing to apply, so the step reads done. Any kind but `none`
 * seeds a root with a `repo_variables` output (ADR-0114: the release contract), so the commands
 * hold for a later kind too.
 */
function deployEnvStep(
  deployKind: DeployKind,
  repo: string,
  link: OnboardingStep["link"],
): StepSpec {
  if (deployKind === "none") {
    return {
      key: "deploy_env",
      instruction: "Nothing to apply: this project doesn't deploy (deploy kind none).",
      commands: [],
      link: null,
      how: "live",
      checks: [done("Deploy kind none")],
    };
  }
  return {
    key: "deploy_env",
    instruction:
      "After the baseline PR merges, in a clone of the repo: copy infra/terraform.tfvars.example to infra/terraform.tfvars with real values, create the state bucket, plan (expected counts: runbook project-env.md), apply, then set the repo variables from the output.",
    commands: [
      {
        label: "Create the state bucket",
        text: `gcloud storage buckets create ${STATE_BUCKET} --project <prod project> --location us-central1 --uniform-bucket-level-access`,
      },
      {
        label: "Keep old state versions",
        text: `gcloud storage buckets update ${STATE_BUCKET} --versioning`,
      },
      {
        label: "Init",
        text: 'terraform -chdir=infra init -backend-config="bucket=<prod project>-tfstate"',
      },
      { label: "Plan", text: "terraform -chdir=infra plan -out=deploy.tfplan" },
      { label: "Apply", text: "terraform -chdir=infra apply deploy.tfplan" },
      {
        label: "Write the repo variables",
        text: `terraform -chdir=infra output -json repo_variables | jq -r 'to_entries[] | "\\(.key)=\\(.value)"' > repo-vars.env`,
      },
      {
        label: "Set them",
        text: `gh variable set --repo ${repo} -f repo-vars.env && rm repo-vars.env`,
      },
    ],
    link,
    how: "hand",
    checks: [],
  };
}

/** A live part's status: unknown beats not yet, which beats done. */
function liveStatus(checks: readonly OnboardingCheck[]): OnboardingStatus {
  if (checks.some((c) => c.status === "unknown")) return "unknown";
  return checks.every((c) => c.status === "done") ? "done" : "not_yet";
}

/**
 * A step's status: live from its checks; hand from Andy's mark; both needs the live part too. A
 * failed read can't say no, so Andy's mark stands for it (it never overrides a "not yet").
 */
export function stepStatus(
  how: OnboardingHow,
  checks: readonly OnboardingCheck[],
  marked: boolean,
): OnboardingStatus {
  if (how === "hand") return marked ? "done" : "not_yet";
  const live = liveStatus(checks);
  if (live === "not_yet") return "not_yet";
  if (how === "live") return live === "unknown" && marked ? "done" : live;
  return marked ? "done" : live === "done" ? "not_yet" : "unknown";
}

const ORDER = Object.keys(ONBOARDING_LABELS) as OnboardingStepKey[];

/** Every step in the runbook's order, with the repo's limits, decided from the facts. */
export function onboarding(f: OnboardingFacts): Onboarding {
  const all = specs(f);
  const steps: OnboardingStep[] = ORDER.map((key) => {
    const spec = all[key];
    const marked = isMarkable(key) ? (f.marks[key] ?? null) : null;
    return {
      ...spec,
      label: ONBOARDING_LABELS[key],
      marked,
      status: stepStatus(spec.how, spec.checks, marked !== null),
    };
  });
  return {
    repo: f.repo.kind === "no_repo" ? null : f.repo.repo,
    limits: repoLimits(f.repo, f.repoCount),
    steps,
    refine: f.refine,
    complete: steps.every((s) => s.status === "done"),
    readAt: f.readAt,
  };
}

/** Every command the steps show for `repo`, for the runbook test. */
export function onboardingCommands(f: OnboardingFacts): OnboardingCommand[] {
  return onboarding(f).steps.flatMap((s) => s.commands);
}
