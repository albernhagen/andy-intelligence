import { readFileSync } from "node:fs";
import type { OnboardingStepKey, ProvingRefine } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { BASELINE_FILES } from "./setup-checklist";
import {
  missingBaselineFiles,
  onboarding,
  onboardingCommands,
  repoLimits,
  stepStatus,
  type OnboardingFacts,
  type OnboardingRepoFacts,
} from "./onboarding";

const REPO = "albernhagen/widgets";
const AT = "2026-11-25T12:00:00.000Z";

/** Folder listings holding every baseline file plus the limits' files. */
function allFiles() {
  const files: Record<string, string[]> = { "": ["pnpm-lock.yaml", ".nvmrc", "package.json"] };
  for (const path of BASELINE_FILES) {
    const cut = path.lastIndexOf("/");
    const dir = cut < 0 ? "" : path.slice(0, cut);
    (files[dir] ??= []).push(path.slice(cut + 1));
  }
  return files;
}

const readRepo = (over: Partial<Extract<OnboardingRepoFacts, { kind: "read" }>> = {}) =>
  ({
    kind: "read",
    repo: REPO,
    private: false,
    defaultBranch: "main",
    files: allFiles(),
    ruleset: { kind: "read", value: true },
    environment: { kind: "read", value: { exists: true, mainOnly: true } },
    ...over,
  }) satisfies OnboardingRepoFacts;

const noRefine: ProvingRefine = {
  runId: null,
  ticketKey: null,
  status: "none",
  url: null,
  error: null,
  candidate: null,
};

function facts(over: Partial<OnboardingFacts> = {}): OnboardingFacts {
  return {
    repoCount: 1,
    repo: readRepo(),
    appInstallUrl: "https://github.com/apps/andy-ai/installations/new",
    refine: {
      ...noRefine,
      runId: "r1",
      ticketKey: "WID-1",
      status: "succeeded",
      url: "https://github.com/albernhagen/widgets/actions/runs/1",
    },
    buildEnabled: true,
    deployKind: "none",
    marks: {
      reusable_workflows: { by: "andy@example.com", at: AT },
      reviewer_token: { by: "andy@example.com", at: AT },
      agent_environment: { by: "andy@example.com", at: AT },
    },
    readAt: AT,
    ...over,
  };
}

const step = (o: ReturnType<typeof onboarding>, key: OnboardingStepKey) =>
  o.steps.find((s) => s.key === key)!;

describe("onboarding", () => {
  it("GivenEveryFactAndMark_WhenDecided_ThenEveryRunbookStepIsDoneInOrder", () => {
    const o = onboarding(facts());

    expect(o.complete).toBe(true);
    expect(o.steps.map((s) => s.key)).toEqual([
      "repo_app",
      "baseline_pr",
      "repo_settings",
      "deploy_env",
      "reusable_workflows",
      "reviewer_token",
      "agent_environment",
      "proving_refine",
      "builds_on",
    ]);
    expect(o.steps.every((s) => s.status === "done")).toBe(true);
    expect(o.limits.every((l) => l.status === "ok")).toBe(true);
  });

  it("GivenARepo_WhenDecided_ThenEveryCommandHasTheRepoFilledIn", () => {
    const commands = onboardingCommands(facts()).map((c) => c.text);

    expect(commands).toContain(`gh repo create ${REPO} --public`);
    expect(commands).toContain(`node platform/baseline/baseline.mjs apply ${REPO} --dry-run`);
    expect(commands).toContain(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${REPO}`);
    expect(commands.filter((c) => c.includes("<owner>"))).toEqual([]);
  });

  it("GivenARepo_WhenDecided_ThenEachHandStepLinksToItsGitHubPage", () => {
    const o = onboarding(facts());

    expect(step(o, "reusable_workflows").link?.url).toBe(
      `https://github.com/${REPO}/settings/actions`,
    );
    expect(step(o, "reviewer_token").link?.url).toBe(
      `https://github.com/${REPO}/settings/secrets/actions`,
    );
    expect(step(o, "agent_environment").link?.url).toBe(
      `https://github.com/${REPO}/settings/environments`,
    );
    expect(step(o, "repo_app").link?.url).toBe("https://github.com/apps/andy-ai/installations/new");
  });

  it("GivenNoMarks_WhenDecided_ThenHandStepsAreNotYetAndShowNoMark", () => {
    const o = onboarding(facts({ marks: {} }));

    expect(step(o, "reusable_workflows")).toMatchObject({ status: "not_yet", marked: null });
    expect(step(o, "reviewer_token")).toMatchObject({ status: "not_yet", how: "hand" });
    expect(step(o, "agent_environment").status).toBe("not_yet");
    expect(o.complete).toBe(false);
  });

  it("GivenAMark_WhenDecided_ThenTheStepShowsWhoMarkedItByHand", () => {
    const o = onboarding(facts());

    expect(step(o, "reviewer_token").marked).toEqual({ by: "andy@example.com", at: AT });
    expect(step(o, "repo_app").marked).toBeNull();
  });

  it("GivenTheEnvironmentIsMissing_WhenMarkedDone_ThenTheStepStaysNotYet", () => {
    const o = onboarding(
      facts({
        repo: readRepo({
          environment: { kind: "read", value: { exists: false, mainOnly: false } },
        }),
      }),
    );

    expect(step(o, "agent_environment").status).toBe("not_yet");
  });

  it("GivenTheAppIsNotInstalled_WhenDecided_ThenRepoStepIsNotYetAndLaterLiveStepsAreUnknown", () => {
    const o = onboarding(facts({ repo: { kind: "not_installed", repo: REPO } }));

    expect(step(o, "repo_app").status).toBe("not_yet");
    expect(step(o, "baseline_pr").status).toBe("unknown");
    expect(step(o, "repo_settings").checks[0]?.detail).toMatch(/install it first/);
    expect(o.limits.filter((l) => l.key !== "one_repo").map((l) => l.status)).toEqual(
      Array(4).fill("unknown"),
    );
  });

  it("GivenAMissingAgentRunWorkflow_WhenDecided_ThenTheBaselineStepNamesIt", () => {
    const files = allFiles();
    files[".github/workflows"] = files[".github/workflows"]!.filter((f) => f !== "agent-run.yml");
    const o = onboarding(facts({ repo: readRepo({ files }) }));

    expect(step(o, "baseline_pr").status).toBe("not_yet");
    expect(step(o, "baseline_pr").checks[0]).toMatchObject({
      label: "agent-run.yml on main",
      status: "not_yet",
    });
  });

  it("GivenARulesetReadFailed_WhenDecided_ThenTheSettingsStepIsUnknownNotDone", () => {
    const o = onboarding(facts({ repo: readRepo({ ruleset: { kind: "unknown", error: "403" } }) }));

    expect(step(o, "repo_settings")).toMatchObject({ status: "unknown" });
  });

  it("GivenARulesetReadFailed_WhenAndyMarksTheStep_ThenItIsDoneAndShowsTheMark", () => {
    const o = onboarding(
      facts({
        repo: readRepo({ ruleset: { kind: "unknown", error: "403" } }),
        marks: { repo_settings: { by: "andy@example.com", at: AT } },
      }),
    );

    expect(step(o, "repo_settings")).toMatchObject({
      status: "done",
      marked: { by: "andy@example.com" },
    });
  });

  it("GivenAMarkedLiveStep_WhenTheReadSaysNotYet_ThenTheMarkDoesNotOverrideIt", () => {
    const o = onboarding(
      facts({
        repo: readRepo({ ruleset: { kind: "read", value: false } }),
        marks: { repo_settings: { by: "andy@example.com", at: AT } },
      }),
    );

    expect(step(o, "repo_settings").status).toBe("not_yet");
  });

  it("GivenNoProjectRepo_WhenDecided_ThenCommandsUseAPlaceholderAndThereAreNoRepoLinks", () => {
    const o = onboarding(facts({ repo: { kind: "no_repo" } }));

    expect(o.repo).toBeNull();
    expect(step(o, "repo_app").commands[0]?.text).toBe("gh repo create <owner>/<name> --public");
    expect(step(o, "reviewer_token").link).toBeNull();
  });

  it("GivenAFailedRefine_WhenDecided_ThenTheRefineStepSaysWhy", () => {
    const o = onboarding(
      facts({ refine: { ...noRefine, runId: "r2", status: "failed", error: "no credential" } }),
    );

    expect(step(o, "proving_refine").checks[0]?.detail).toBe(
      "the last refine failed: no credential",
    );
  });

  it("GivenARefineReadThatCantSeeFarEnough_WhenDecided_ThenCantTellUntilMarked", () => {
    const unseen = { ...noRefine, status: "unknown" as const };

    expect(step(onboarding(facts({ refine: unseen })), "proving_refine").status).toBe("unknown");
    const marked = onboarding(
      facts({ refine: unseen, marks: { proving_refine: { by: "andy@example.com", at: AT } } }),
    );
    expect(step(marked, "proving_refine").status).toBe("done");
  });

  it("GivenNoRefineAndAMark_WhenDecided_ThenTheMarkDoesNotOverrideIt", () => {
    const o = onboarding(
      facts({ refine: noRefine, marks: { proving_refine: { by: "andy@example.com", at: AT } } }),
    );

    expect(step(o, "proving_refine").status).toBe("not_yet");
  });
});

describe("repoLimits", () => {
  it("GivenAPrivateRepoOnAnotherBranchWithoutPnpm_WhenChecked_ThenEachFailingLimitIsNamed", () => {
    const limits = repoLimits(
      readRepo({ private: true, defaultBranch: "master", files: { "": ["package.json"] } }),
      2,
    );

    expect(limits.filter((l) => l.status === "fails").map((l) => l.key)).toEqual([
      "public",
      "main",
      "pnpm_lock",
      "nvmrc",
      "one_repo",
    ]);
    expect(limits.find((l) => l.key === "main")?.detail).toMatch(/master/);
  });
});

describe("missingBaselineFiles", () => {
  it("GivenAMissingFolder_WhenChecked_ThenEveryFileInItIsMissing", () => {
    const files = allFiles();
    delete files["scripts"];

    expect(missingBaselineFiles(files)).toEqual(["scripts/format-edited-file.mjs"]);
  });
});

describe("onboarding deploy environments (AI-109: M6.22)", () => {
  it("GivenDeployKindNone_WhenDecided_ThenTheStepIsDoneWithNothingToApply", () => {
    const s = step(onboarding(facts()), "deploy_env");
    expect(s.status).toBe("done");
    expect(s.commands).toEqual([]);
  });

  it("GivenACloudRunProject_WhenDecided_ThenTheApplyIsAHandStepNotYetDone", () => {
    const o = onboarding(facts({ deployKind: "cloud-run" }));
    const s = step(o, "deploy_env");
    expect(s.how).toBe("hand");
    expect(s.status).toBe("not_yet");
    expect(o.complete).toBe(false);
    expect(s.commands.map((c) => c.text)).toContain(
      "terraform -chdir=infra plan -out=deploy.tfplan",
    );
    expect(s.commands.map((c) => c.text)).toContain(
      `gh variable set --repo ${REPO} -f repo-vars.env && rm repo-vars.env`,
    );
    expect(s.link?.url).toBe(`https://github.com/${REPO}/settings/variables/actions`);
  });

  it("GivenACloudRunProjectMarkedDone_WhenDecided_ThenTheStepIsDone", () => {
    const o = onboarding(
      facts({
        deployKind: "cloud-run",
        marks: { ...facts().marks, deploy_env: { by: "andy@example.com", at: AT } },
      }),
    );
    expect(step(o, "deploy_env").status).toBe("done");
  });
});

describe("stepStatus", () => {
  it("GivenABothStepWhoseReadFailed_WhenMarked_ThenTheMarkStands", () => {
    expect(stepStatus("both", [{ label: "x", status: "unknown", detail: "403" }], true)).toBe(
      "done",
    );
    expect(stepStatus("both", [{ label: "x", status: "unknown", detail: "403" }], false)).toBe(
      "unknown",
    );
  });
});

describe("runbook managed-project.md", () => {
  const runbook = readFileSync(
    new URL("../../../docs/runbooks/managed-project.md", import.meta.url),
    "utf8",
  );

  it("GivenTheStepsCommands_WhenCompared_ThenTheRunbookHasEachOne", () => {
    // The runbook is the source the UI matches: each command, with the runbook's placeholder.
    const commands = onboardingCommands(
      facts({ repo: { kind: "no_repo" }, deployKind: "cloud-run" }),
    ).map((c) => c.text);
    for (const command of commands) expect(runbook).toContain(command);
  });
});
