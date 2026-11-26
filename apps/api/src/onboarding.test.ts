import { InMemoryRunStore, InMemoryWorkTracker, type Onboarding } from "@andy/contracts";
import { BASELINE_FILES } from "@andy/domain";
import { describe, expect, it } from "vitest";
import { createdApp, githubApp, REPO } from "./github/test-app";
import { provingRefine, REFINE_LOOKBACK_RUNS } from "./onboarding";

/** AI-381: GET /api/projects/{p}/onboarding and POST …/onboarding/marks over the CodeHost fake. */

const KEY = REPO.toLowerCase();

async function setup(opts: { connected?: boolean } = {}) {
  const t = githubApp();
  if (opts.connected !== false) {
    await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00.000Z" });
  }
  await t.tracker.createProject({ name: "Widgets", key: "WID", repos: [REPO] });
  const read = async (query = "") => {
    const res = await t.call(`/api/projects/wid/onboarding${query}`);
    return { status: res.status, body: (await res.json()) as Onboarding };
  };
  const mark = async (step: string, done = true) => {
    const res = await t.call("/api/projects/wid/onboarding/marks", {
      method: "POST",
      body: JSON.stringify({ step, done }),
    });
    return { status: res.status, body: (await res.json()) as Onboarding };
  };
  const status = (o: Onboarding, key: string) => o.steps.find((s) => s.key === key)?.status;
  /** Every baseline file, the limits' files, the ruleset and a main-only environment. */
  const fullyOnboard = () => {
    for (const path of [...BASELINE_FILES, "pnpm-lock.yaml", ".nvmrc"]) t.host.files.set(path, "x");
    t.host.settings.set(`${KEY}#rulesets`, {
      status: 200,
      data: [{ name: "protect-main", enforcement: "active" }],
    });
    t.host.settings.set(`${KEY}#environments/agent`, {
      status: 200,
      data: {
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      },
    });
    t.host.settings.set(`${KEY}#environments/agent/deployment-branch-policies`, {
      status: 200,
      data: { branch_policies: [{ name: "main", type: "branch" }] },
    });
  };
  return { ...t, read, mark, status, fullyOnboard };
}

describe("onboarding API (AI-381)", () => {
  it("GivenAFullyOnboardedRepo_WhenRead_ThenLiveStepsAreDoneAndHandStepsWaitForAMark", async () => {
    const t = await setup();
    t.fullyOnboard();

    const { status, body } = await t.read();

    expect(status).toBe(200);
    expect(body.limits.every((l) => l.status === "ok")).toBe(true);
    expect(t.status(body, "repo_app")).toBe("done");
    expect(t.status(body, "baseline_pr")).toBe("done");
    expect(t.status(body, "repo_settings")).toBe("done");
    expect(t.status(body, "reusable_workflows")).toBe("not_yet");
    expect(t.status(body, "agent_environment")).toBe("not_yet");
    expect(body.steps.find((s) => s.key === "repo_app")?.link?.url).toBe(
      "https://github.com/apps/andy-intelligence/installations/new",
    );
  });

  it("GivenAnEmptyRepo_WhenRead_ThenEachFailingLimitIsNamed", async () => {
    const t = await setup();

    const { body } = await t.read();

    expect(body.limits.filter((l) => l.status === "fails").map((l) => l.key)).toEqual([
      "pnpm_lock",
      "nvmrc",
    ]);
    expect(t.status(body, "baseline_pr")).toBe("not_yet");
  });

  it("GivenARefusedSettingsRead_WhenRead_ThenTheStepIsUnknownNotDone", async () => {
    const t = await setup();
    t.fullyOnboard();
    t.host.settings.set(`${KEY}#rulesets`, { status: 403, data: null });

    const { body } = await t.read();

    expect(t.status(body, "repo_settings")).toBe("unknown");
  });

  it("GivenGitHubIsNotConnected_WhenRead_ThenTheRepoStepIsNotYetAndNothingIsRead", async () => {
    const t = await setup({ connected: false });

    const { body } = await t.read();

    expect(t.status(body, "repo_app")).toBe("not_yet");
    expect(t.status(body, "baseline_pr")).toBe("unknown");
    expect(t.host.settingReads).toEqual([]);
  });

  it("GivenARecentRead_WhenReadAgain_ThenTheCodeHostIsNotAskedTwice", async () => {
    const t = await setup();
    t.fullyOnboard();
    await t.read();
    const reads = t.host.settingReads.length;

    await t.read();
    await t.read("?refresh=true");

    // Within the cache window a refresh younger than its floor reuses the read too.
    expect(t.host.settingReads.length).toBe(reads);
  });

  it("GivenAHandStep_WhenAndyMarksItDone_ThenItIsDoneAndShowsWhoMarkedIt", async () => {
    const t = await setup();
    t.fullyOnboard();

    const { status, body } = await t.mark("reusable_workflows");

    expect(status).toBe(200);
    expect(body.steps.find((s) => s.key === "reusable_workflows")).toMatchObject({
      status: "done",
      marked: { by: "andy@example.com" },
    });
    const cleared = await t.mark("reusable_workflows", false);
    expect(t.status(cleared.body, "reusable_workflows")).toBe("not_yet");
  });

  it("GivenAStepTheAppReads_WhenMarked_ThenRefusedAsInvalid", async () => {
    const t = await setup();

    expect((await t.mark("builds_on")).status).toBe(400);
  });

  it("GivenARepoSettingRead_WhenOnboarded_ThenNoSecretIsEverRead", async () => {
    const t = await setup();
    t.fullyOnboard();

    await t.read();

    expect(t.host.settingReads.filter((r) => /secret/i.test(r))).toEqual([]);
  });

  it("GivenAnUnknownProject_WhenRead_ThenNotFound", async () => {
    const t = await setup();

    expect((await t.call("/api/projects/nope/onboarding")).status).toBe(404);
  });
});

describe("provingRefine (AI-381)", () => {
  const NOW = new Date("2026-11-25T12:00:00.000Z");

  it("GivenAnUpNextTicketAndASucceededRefine_WhenRead_ThenItIsSucceededWithTheCandidate", async () => {
    const tracker = new InMemoryWorkTracker();
    const runs = new InMemoryRunStore();
    await tracker.createProject({ name: "Widgets", key: "WID" });
    const ticket = await tracker.createTicket("wid", { title: "First story" }, "system");
    await tracker.updateTicket("wid", ticket.id, { fields: { upNextRank: "0001" } }, "system");
    const run = await runs.create({
      projectId: "wid",
      ticketId: ticket.id,
      step: "refine",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: "fast",
      deadline: null,
      prompt: "x",
      maxTurns: 1,
    });
    await runs.update(run.id, { status: "running" }, ["queued"]);
    await runs.update(run.id, { status: "succeeded", endedAt: NOW.toISOString() }, ["running"]);

    const refine = await provingRefine(tracker, runs, "wid", NOW);

    expect(refine).toMatchObject({
      runId: run.id,
      ticketKey: "WID-1",
      status: "succeeded",
      candidate: { key: "WID-1" },
    });
  });

  const ROUTE = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;
  async function endedRun(
    runs: InMemoryRunStore,
    ticketId: string,
    step: "refine" | "build",
    status: "succeeded" | "failed",
    endedAt: string,
  ) {
    const run = await runs.create({
      projectId: "wid",
      ticketId,
      step,
      route: ROUTE,
      tier: "fast",
      deadline: null,
      prompt: "x",
      maxTurns: 1,
    });
    await runs.update(run.id, { status: "running" }, ["queued"]);
    await runs.update(run.id, { status, endedAt }, ["running"]);
    return run;
  }

  it("GivenASucceededRefineThenMoreOtherRunsThanTheCap_WhenRead_ThenStillSucceeded", async () => {
    const tracker = new InMemoryWorkTracker();
    const runs = new InMemoryRunStore();
    await tracker.createProject({ name: "Widgets", key: "WID" });
    const ticket = await tracker.createTicket("wid", { title: "First story" }, "system");
    await tracker.updateTicket(
      "wid",
      ticket.id,
      { stage: { to: "ready", reason: null } },
      "system",
    );
    const proving = await endedRun(
      runs,
      ticket.id,
      "refine",
      "succeeded",
      "2026-11-20T00:00:00.000Z",
    );
    for (let i = 0; i <= REFINE_LOOKBACK_RUNS; i++) {
      await endedRun(
        runs,
        ticket.id,
        "build",
        "failed",
        `2026-11-21T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`,
      );
    }

    expect(await provingRefine(tracker, runs, "wid", NOW)).toMatchObject({
      runId: proving.id,
      status: "succeeded",
    });
  });

  it("GivenASucceededRefineThenAFailedOne_WhenRead_ThenTheSucceededOneCounts", async () => {
    const tracker = new InMemoryWorkTracker();
    const runs = new InMemoryRunStore();
    await tracker.createProject({ name: "Widgets", key: "WID" });
    const ticket = await tracker.createTicket("wid", { title: "First story" }, "system");
    const ok = await endedRun(runs, ticket.id, "refine", "succeeded", "2026-11-20T00:00:00.000Z");
    await endedRun(runs, ticket.id, "refine", "failed", "2026-11-22T00:00:00.000Z");

    expect(await provingRefine(tracker, runs, "wid", NOW)).toMatchObject({
      runId: ok.id,
      status: "succeeded",
    });
  });

  it("GivenNoRefine_WhenRead_ThenNoneAndNoCandidateWithoutUpNext", async () => {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "Widgets", key: "WID" });
    await tracker.createTicket("wid", { title: "Idea" }, "system");

    expect(await provingRefine(tracker, new InMemoryRunStore(), "wid", NOW)).toMatchObject({
      status: "none",
      candidate: null,
    });
  });
});
