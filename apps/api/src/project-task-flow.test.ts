import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import type { ActionsClaims } from "./github/token";

/**
 * AI-134: project-level agent tasks end to end in-process: the real API and domain with only
 * GitHub faked. Andy starts a plan-project or ideate task; the executor reads its context (no
 * ticket) and reports; the result is stored as the owner-only routes store a submitted one.
 */

/** Stand-in for Actions OIDC verification: the bearer is the JSON of its claims. */
const verify = async (jwt: string): Promise<ActionsClaims> => {
  if (!jwt.startsWith("{")) throw new Error("bad signature");
  return JSON.parse(jwt) as ActionsClaims;
};

const proposal = {
  summary: "Skeleton first.",
  milestones: [
    {
      title: "Walking skeleton",
      goal: "Andy can open it.",
      doneWhen: ["It loads"],
      slices: ["CI"],
    },
  ],
};

interface RunBody {
  id: string;
  step: string;
  status: string;
  ticketId: string | null;
  idea: string | null;
  summary: string | null;
  error: string | null;
}

async function setup(connected = true) {
  const t = githubApp({ verifyActionsToken: verify });
  if (connected) await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
  const post = (path: string, body: unknown = {}, token: string | null = "andy") =>
    t.call(path, { method: "POST", body: JSON.stringify(body) }, token);
  const project = await t.tracker.createProject({ name: "Trail log", key: "TRL", repos: [REPO] });
  const asExecutor = (path: string, init: RequestInit = {}) => {
    const claims: ActionsClaims = {
      repository: REPO,
      workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
      job_workflow_ref: CLAUDE_EXECUTOR_REF,
      run_id: [...t.host.workflowRuns.keys()].at(-1)!,
    };
    return t.call(path, init, JSON.stringify(claims));
  };
  return { t, json, post, project, base: `/api/projects/${project.id}`, asExecutor };
}

describe("project task flow (AI-134)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAndy_WhenHeStartsAPlanProjectTaskAndItReports_ThenThePlanWaitsForHim", async () => {
    const { t, json, post, base, asExecutor } = await setup();

    const started = await post(`${base}/plan/agent-task`);
    expect(started.status).toBe(201);
    const run = await json<RunBody>(started);
    expect(run).toMatchObject({ step: "plan-project", status: "queued", ticketId: null });
    expect([...t.host.workflowRuns.values()][0]!.inputs).toEqual({
      run_id: run.id,
      credential: "subscription",
    });

    const context = await json<{ step: string; ticket: null; prompt: string }>(
      asExecutor(`/runs/${run.id}/context`),
    );
    expect(context).toMatchObject({ step: "plan-project", ticket: null });

    const report = await asExecutor(`/runs/${run.id}/report`, {
      method: "POST",
      body: JSON.stringify({
        status: "succeeded",
        summary: "Planned.",
        output: proposal,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: null,
      }),
    });
    expect(report.status).toBe(200);
    const { plan } = await json<{ plan: { status: string; proposedBy: string } }>(
      t.call(`${base}/plan`),
    );
    expect(plan).toMatchObject({ status: "proposed", proposedBy: `agent:${run.id}` });

    // A second start while the plan waits is refused before anything is dispatched.
    expect((await post(`${base}/plan/agent-task`)).status).toBe(409);
    expect(t.host.workflowRuns.size).toBe(1);
  });

  it("GivenAnIdea_WhenAndyStartsAnIdeateTask_ThenTheRunKeepsTheIdea", async () => {
    const { json, post, base } = await setup();

    const started = await post(`${base}/ideate/agent-task`, { idea: "A weekly summary" });
    expect(started.status).toBe(201);
    expect(await json<RunBody>(started)).toMatchObject({
      step: "ideate",
      ticketId: null,
      idea: "A weekly summary",
    });
  });

  it("GivenABadRequest_WhenStartingAProjectTask_ThenItIsRefusedAndNothingIsDispatched", async () => {
    const { t, post, base } = await setup();

    expect((await post(`${base}/ideate/agent-task`, { idea: "" })).status).toBe(400);
    expect((await post(`${base}/ideate/agent-task`, { idea: "x", actor: "andy" })).status).toBe(
      400,
    );
    expect((await post(`${base}/plan/agent-task`, {}, null)).status).toBe(401);
    expect((await post(`/api/projects/nope/plan/agent-task`)).status).toBe(404);
    expect(t.host.workflowRuns.size).toBe(0);
  });

  it("GivenGitHubNotConnected_WhenStartingAProjectTask_ThenTheDispatchFailsAndNothingIsInFlight", async () => {
    const { t, post, base, project } = await setup(false);

    expect((await post(`${base}/plan/agent-task`)).status).toBe(502);
    expect(await t.runs.listActive(project.id)).toEqual([]);
  });
});
