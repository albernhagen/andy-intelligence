import { BASELINE_FILES, THREAT_MODEL_PATH, type SetupChecklist } from "@andy/domain";
import { describe, expect, it } from "vitest";
import { createdApp, githubApp, REPO } from "./github/test-app";

/** AI-95: M5.15: GET /api/projects/{p}/setup over the CodeHost fake. */

async function setup(opts: { connected?: boolean; repos?: string[] } = {}) {
  const t = githubApp();
  if (opts.connected !== false) {
    await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00.000Z" });
  }
  await t.tracker.createProject({
    name: "Andy Intelligence",
    key: "AI",
    repos: opts.repos ?? [REPO],
  });
  const read = async (path = "/api/projects/ai/setup") => {
    const res = await t.call(path);
    return { status: res.status, body: (await res.json()) as SetupChecklist };
  };
  const statuses = (list: SetupChecklist) =>
    Object.fromEntries(list.items.map((i) => [i.key, i.status]));
  return { ...t, read, statuses };
}

describe("setup checklist API (AI-95: M5.15)", () => {
  it("GivenAFullyBaselinedRepo_WhenRead_ThenRepoItemsAreDoneAndDeployAndBudgetAreNotYet", async () => {
    const t = await setup();
    for (const path of [...BASELINE_FILES, THREAT_MODEL_PATH]) t.host.files.set(path, "x");

    const { status, body } = await t.read();

    expect(status).toBe(200);
    expect(body.repo).toBe(REPO);
    expect(t.statuses(body)).toEqual({
      repo_connected: "done",
      baseline_merged: "done",
      deploy_proven: "not_yet",
      threat_model_started: "done",
      budget_caps_set: "not_yet",
    });
    expect(body.complete).toBe(false);
  });

  it("GivenAnEmptyRepo_WhenRead_ThenBaselineAndThreatModelAreMissing", async () => {
    const t = await setup();

    const { body } = await t.read();

    expect(t.statuses(body)).toMatchObject({
      repo_connected: "done",
      baseline_merged: "missing",
      threat_model_started: "missing",
    });
  });

  it("GivenTheCodeHostThrows_WhenRead_ThenRepoItemsAreUnknownWithTheError", async () => {
    const t = await setup();
    t.host.readFile = () => Promise.reject(new Error("rate limited"));

    const { status, body } = await t.read();

    expect(status).toBe(200);
    for (const key of ["repo_connected", "baseline_merged", "threat_model_started"]) {
      expect(body.items.find((i) => i.key === key)).toMatchObject({
        status: "unknown",
        detail: `couldn't read ${REPO}: rate limited`,
      });
    }
  });

  it("GivenGitHubIsNotConnected_WhenRead_ThenRepoConnectedIsMissingAndNothingIsDone", async () => {
    const t = await setup({ connected: false });
    for (const path of [...BASELINE_FILES, THREAT_MODEL_PATH]) t.host.files.set(path, "x");

    const { body } = await t.read();

    expect(t.statuses(body)).toMatchObject({
      repo_connected: "missing",
      baseline_merged: "unknown",
      threat_model_started: "unknown",
    });
  });

  it("GivenAProjectWithNoRepo_WhenRead_ThenRepoConnectedIsMissing", async () => {
    const t = await setup({ repos: [] });

    const { body } = await t.read();

    expect(body.repo).toBeNull();
    expect(t.statuses(body).repo_connected).toBe("missing");
  });

  it("GivenAnUnknownProject_WhenRead_Then404", async () => {
    const t = await setup();

    expect((await t.read("/api/projects/nope/setup")).status).toBe(404);
  });

  it("GivenNoSignIn_WhenRead_Then401", async () => {
    const t = await setup();

    expect((await t.call("/api/projects/ai/setup", {}, null)).status).toBe(401);
  });
});
