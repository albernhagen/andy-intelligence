import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import type { ActionsClaims } from "./github/token";
import { RUN_REPORT_MAX_BYTES } from "./runs";

/** Stand-in for Actions OIDC verification: the bearer is the JSON of its claims. */
const verify = async (jwt: string): Promise<ActionsClaims> => {
  if (!jwt.startsWith("{")) throw new Error("bad signature");
  return JSON.parse(jwt) as ActionsClaims;
};

async function setup(connected = true) {
  const t = githubApp({ verifyActionsToken: verify });
  if (connected) await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const ticket = await t.tracker.createTicket(
    project.id,
    { type: "feature", title: "Board" },
    "andy",
  );
  const runsPath = `/api/projects/${project.id}/tickets/${ticket.id}/runs`;
  const start = () =>
    t.call(runsPath, { method: "POST", body: JSON.stringify({ step: "refine" }) });
  /** Claims of the workflow run that was dispatched for `runId`. */
  const claimsFor = (externalId: string): ActionsClaims => ({
    repository: REPO,
    workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
    job_workflow_ref: CLAUDE_EXECUTOR_REF,
    run_id: externalId,
  });
  const callback = (path: string, claims: ActionsClaims | null, init: RequestInit = {}) =>
    t.call(path, init, claims ? JSON.stringify(claims) : null);
  return { ...t, project, ticket, runsPath, start, claimsFor, callback };
}

const result = {
  status: "succeeded",
  summary: "{}",
  tokensIn: 1000,
  tokensOut: 200,
  costUsd: 0.01,
  output: {
    summary: "**Ask**: a board",
    type: "feature",
    size: "S",
    sizeReason: "one screen",
    outOfScope: [],
    touches: [],
    questions: [{ text: "Kanban or list?" }],
  },
};

describe("run routes", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenGitHubIsConnected_WhenAndyStartsARefineRun_ThenItIsDispatchedAndListed", async () => {
    const { start, call, runsPath, host } = await setup();
    const res = await start();
    expect(res.status).toBe(201);
    const run = (await res.json()) as { id: string; status: string };
    expect(run.status).toBe("queued");
    expect([...host.workflowRuns.values()][0]?.inputs).toEqual({
      run_id: run.id,
      credential: "subscription",
    });
    const list = (await (await call(runsPath)).json()) as { id: string }[];
    expect(list.map((r) => r.id)).toEqual([run.id]);
  });

  it("GivenGitHubIsNotConnected_WhenARunIsStarted_Then502AndTheRunIsFailed", async () => {
    const { start, call, runsPath } = await setup(false);
    const res = await start();
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/isn't connected/);
    const [run] = (await (await call(runsPath)).json()) as { status: string }[];
    expect(run?.status).toBe("failed");
  });

  it("GivenARunInFlight_WhenAnotherIsStarted_Then409", async () => {
    const { start } = await setup();
    await start();
    expect((await start()).status).toBe(409);
  });

  it("GivenAStepNotBuiltYet_WhenStarted_Then400", async () => {
    const { call, runsPath } = await setup();
    const res = await call(runsPath, { method: "POST", body: JSON.stringify({ step: "build" }) });
    expect(res.status).toBe(400);
  });

  it("GivenNoAndyToken_WhenRunsAreListed_Then401", async () => {
    const { call, runsPath } = await setup();
    expect((await call(runsPath, {}, null)).status).toBe(401);
  });
});

describe("run callbacks", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  async function dispatched() {
    const t = await setup();
    const run = (await (await t.start()).json()) as {
      id: string;
      executor: { externalId: string };
    };
    return { ...t, run, claims: t.claimsFor(run.executor.externalId) };
  }

  it("GivenTheDispatchedWorkflowRun_WhenItAsksForContext_ThenItGetsItsInstructions", async () => {
    const { run, claims, callback } = await dispatched();
    const res = await callback(`/runs/${run.id}/context`, claims);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      runId: run.id,
      step: "refine",
      model: "sonnet",
      maxTurns: 30,
    });
  });

  it("GivenAnotherWorkflowRunOrWorkflow_WhenItAsks_Then403", async () => {
    const { run, claims, callback } = await dispatched();
    expect((await callback(`/runs/${run.id}/context`, { ...claims, run_id: "999" })).status).toBe(
      403,
    );
    const otherWorkflow = { ...claims, job_workflow_ref: claims.workflow_ref };
    expect((await callback(`/runs/${run.id}/context`, otherWorkflow)).status).toBe(403);
    expect(
      (await callback(`/runs/${run.id}/context`, { ...claims, repository: "evil/repo" })).status,
    ).toBe(403);
  });

  it("GivenNoOrAPartialToken_WhenCallingBack_Then401", async () => {
    const { run, claims, callback } = await dispatched();
    expect((await callback(`/runs/${run.id}/context`, null)).status).toBe(401);
    const noJob = { ...claims, job_workflow_ref: undefined };
    expect((await callback(`/runs/${run.id}/context`, noJob)).status).toBe(401);
  });

  it("GivenAnUnknownRun_WhenCallingBack_Then404", async () => {
    const { claims, callback } = await dispatched();
    expect((await callback(`/runs/nope/context`, claims)).status).toBe(404);
    expect((await callback(`/runs/..%2F..%2Fx/context`, claims)).status).toBe(404);
  });

  it("GivenTheRunReports_WhenReplayed_ThenRecordedOnceAndTheTicketGetsTheSummaryAndQuestions", async () => {
    const { run, claims, callback, tracker, project, ticket } = await dispatched();
    const report = () =>
      callback(`/runs/${run.id}/report`, claims, { method: "POST", body: JSON.stringify(result) });
    expect(await (await report()).json()).toEqual({ result: "recorded" });
    expect(await (await report()).json()).toEqual({ result: "duplicate" });
    const comments = (await tracker.listEvents(project.id, ticket.id)).filter(
      (e) => e.actor === `agent:${run.id}`,
    );
    expect(comments.filter((e) => e.kind === "comment").map((e) => e.body)).toEqual([
      "**Ask**: a board\n\nAsked 1 question(s): answer them in Needs you.",
    ]);
    expect((await tracker.listQuestions({ ticketId: ticket.id })).map((q) => q.text)).toEqual([
      "Kanban or list?",
    ]);
    // A finished run can't be restarted by asking for context again.
    expect((await callback(`/runs/${run.id}/context`, claims)).status).toBe(409);
  });

  it("GivenAMalformedOrOversizedReport_WhenPosted_Then400Or413", async () => {
    const { run, claims, callback } = await dispatched();
    const post = (body: string) =>
      callback(`/runs/${run.id}/report`, claims, { method: "POST", body });
    expect((await post(JSON.stringify({ ...result, status: "done" }))).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    const huge = JSON.stringify({ ...result, summary: "x".repeat(RUN_REPORT_MAX_BYTES) });
    expect((await post(huge)).status).toBe(413);
  });
});
