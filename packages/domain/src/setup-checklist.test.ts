import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASELINE_FILES,
  NOT_YET_M6,
  setupChecklist,
  type RepoFacts,
  type SetupItemKey,
} from "./setup-checklist";

const REPO = "albernhagen/andy-intelligence";
const budgeted = { repos: [REPO], monthlyBudgetUsd: 50 };
const allRead: RepoFacts = {
  kind: "read",
  repo: REPO,
  missingBaselineFiles: [],
  threatModel: true,
};

const statusOf = (list: ReturnType<typeof setupChecklist>, key: SetupItemKey) =>
  list.items.find((i) => i.key === key);

describe("setupChecklist", () => {
  it("GivenEveryStepDoneAndADeployFact_WhenChecked_ThenItIsComplete", () => {
    const list = setupChecklist(budgeted, allRead, true);

    expect(list.complete).toBe(true);
    expect(list.items.map((i) => i.status)).toEqual(Array(5).fill("done"));
    expect(list.items.map((i) => i.label)).toEqual([
      "Repo connected",
      "Baseline merged",
      "Deploy proven",
      "Threat model started",
      "Budget caps set",
    ]);
  });

  it("GivenNoDeployFact_WhenChecked_ThenDeployReadsNotYetAndTheListIsIncomplete", () => {
    const list = setupChecklist(budgeted, allRead);

    expect(statusOf(list, "deploy_proven")).toMatchObject({
      status: "not_yet",
      detail: NOT_YET_M6,
    });
    expect(list.complete).toBe(false);
  });

  it("GivenMissingBaselineFilesAndThreatModel_WhenChecked_ThenBothAreMissingWithWhatIsLeft", () => {
    const list = setupChecklist(budgeted, {
      kind: "read",
      repo: REPO,
      missingBaselineFiles: ["a.yml", "b.yml", "c.yml", "d.yml", "e.yml"],
      threatModel: false,
    });

    expect(statusOf(list, "baseline_merged")).toMatchObject({
      status: "missing",
      detail: "missing a.yml, b.yml, c.yml and 2 more",
    });
    expect(statusOf(list, "threat_model_started")?.status).toBe("missing");
    expect(statusOf(list, "repo_connected")?.status).toBe("done");
  });

  it("GivenNoMonthlyBudget_WhenChecked_ThenBudgetCapsReadNotYet", () => {
    const list = setupChecklist({ ...budgeted, monthlyBudgetUsd: null }, allRead, true);

    expect(statusOf(list, "budget_caps_set")).toMatchObject({
      status: "not_yet",
      detail: NOT_YET_M6,
    });
    expect(list.complete).toBe(false);
  });

  it("GivenTheRepoCouldNotBeRead_WhenChecked_ThenRepoItemsAreUnknownWithTheErrorNotDone", () => {
    const list = setupChecklist(budgeted, { kind: "error", repo: REPO, error: "Bad credentials" });

    for (const key of ["repo_connected", "baseline_merged", "threat_model_started"] as const) {
      expect(statusOf(list, key)).toMatchObject({
        status: "unknown",
        detail: `couldn't read ${REPO}: Bad credentials`,
      });
    }
    expect(statusOf(list, "budget_caps_set")?.status).toBe("done");
    expect(list.complete).toBe(false);
  });

  it("GivenTheAppIsNotInstalled_WhenChecked_ThenRepoConnectedIsMissingAndFileItemsUnknown", () => {
    const list = setupChecklist(budgeted, { kind: "not_installed", repo: REPO });

    expect(statusOf(list, "repo_connected")?.status).toBe("missing");
    expect(statusOf(list, "baseline_merged")?.status).toBe("unknown");
    expect(statusOf(list, "threat_model_started")?.status).toBe("unknown");
  });

  it("GivenNoRepo_WhenChecked_ThenRepoConnectedIsMissingAndNoRepoIsNamed", () => {
    const list = setupChecklist({ repos: [], monthlyBudgetUsd: 50 }, { kind: "no_repo" });

    expect(list.repo).toBeNull();
    expect(statusOf(list, "repo_connected")?.status).toBe("missing");
    expect(statusOf(list, "baseline_merged")?.status).toBe("unknown");
  });

  it("GivenTheBaselineManifest_WhenComparedWithBaselineFiles_ThenTheyListTheSameManagedFiles", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../../platform/baseline/manifest.json", import.meta.url), "utf8"),
    ) as { managed: { path: string }[] };

    expect([...BASELINE_FILES]).toEqual(manifest.managed.map((f) => f.path));
  });
});
