import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import { InMemoryDeploymentStore, type Run, type Ticket } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deployWorkflowRef } from "./deployments";
import { REPO, createdApp, githubApp } from "./github/test-app";
import type { ActionsClaims } from "./github/token";

/**
 * AI-188: M6.7: Verification run, end to end in-process: the real API, domain and executor
 * callbacks with only GitHub faked. A dev deploy's finish report starts one verify task for the
 * Verifying ticket it contains; the executor reads the deployed URL and commit from the run's
 * context; the verdict moves the ticket.
 */

const verify = async (jwt: string): Promise<ActionsClaims> => JSON.parse(jwt) as ActionsClaims;
const SHA = "d".repeat(40);
const URL_ = "https://ai-dev.example.run.app";

async function setup() {
  const deployments = new InMemoryDeploymentStore();
  const t = githubApp({ verifyActionsToken: verify }, { deployments });
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  let project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  project = await t.tracker.updateProject(project.id, {
    deployKind: "cloud-run",
    environments: "dev-and-prod",
    buildEnabled: true,
  });
  const ticket = await t.tracker.createTicket(
    project.id,
    {
      type: "feature",
      title: "Board",
      body: "b",
      acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
      size: "S",
      sizeReason: "s",
    },
    "andy",
  );
  for (const to of ["ready", "in_progress", "ready_for_review", "verifying"] as const) {
    await t.tracker.updateTicket(
      project.id,
      ticket.id,
      { stage: { to, forced: true, reason: null } },
      "andy",
    );
  }
  await t.tracker.linkPullRequest(
    project.id,
    ticket.id,
    {
      number: 7,
      url: `https://github.com/${REPO}/pull/7`,
      state: "merged",
      mergeSha: "e".repeat(40),
    },
    "system",
  );
  const deployToken = JSON.stringify({
    repository: REPO,
    workflow_ref: deployWorkflowRef(REPO),
    job_workflow_ref: deployWorkflowRef(REPO),
    run_id: "99",
    sha: SHA,
  } satisfies ActionsClaims);
  const post = (path: string, body: unknown, token: string) =>
    t.call(path, { method: "POST", body: JSON.stringify(body) }, token);
  const deploy = async (status: "succeeded" | "failed") => {
    const started = await post(
      "/deployments",
      { imageDigest: `sha256:${"a".repeat(64)}`, environment: "dev", url: URL_ },
      deployToken,
    );
    expect(started.status).toBe(201);
    const { deploymentId } = (await started.json()) as { deploymentId: string };
    expect(
      (await post(`/deployments/${deploymentId}/finish`, { status }, deployToken)).status,
    ).toBe(200);
    return deploymentId;
  };
  const executorToken = (run: Run) =>
    JSON.stringify({
      repository: REPO,
      workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
      job_workflow_ref: CLAUDE_EXECUTOR_REF,
      run_id: run.executor!.externalId,
    } satisfies ActionsClaims);
  const reload = async (): Promise<Ticket> => (await t.tracker.getTicket(project.id, ticket.id))!;
  return { t, project, ticket, deployments, deploy, post, executorToken, reload };
}

describe("verification flow (AI-188)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAVerifyingTicket_WhenItsDevDeploySucceedsAndTheVerdictPasses_ThenTheTicketIsDone", async () => {
    const s = await setup();

    const deploymentId = await s.deploy("succeeded");

    const [run] = await s.t.runs.listActive(s.project.id);
    expect(run).toMatchObject({ step: "verify", ticketId: null, deploymentId });
    expect(run!.verifyTicketIds).toEqual([s.ticket.id]);
    expect((await s.deployments.get(deploymentId))?.verification?.status).toBe("started");

    const context = await s.t.call(`/runs/${run!.id}/context`, {}, s.executorToken(run!));
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({
      step: "verify",
      ticket: null,
      verify: { url: URL_, gitSha: SHA },
    });

    const report = await s.post(
      `/runs/${run!.id}/report`,
      {
        status: "succeeded",
        summary: "{}",
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        output: {
          summary: "The board lists tickets.",
          verdict: "pass",
          tests: [],
          tickets: [
            {
              key: s.ticket.key,
              verdict: "pass",
              criteria: [
                {
                  criterion: "lists tickets",
                  result: "pass",
                  reason: "",
                  evidence: [{ kind: "response", detail: "GET / 200: Board" }],
                },
              ],
            },
          ],
        },
      },
      s.executorToken(run!),
    );
    expect(report.status).toBe(200);
    expect((await s.reload()).stage).toBe("done");
    expect((await s.t.runs.get(run!.id))?.status).toBe("succeeded");
  });

  it("GivenAVerifyingTicket_WhenItsDevDeployFails_ThenItGoesToInProgressWithNeedsYou", async () => {
    const s = await setup();

    await s.deploy("failed");

    expect(await s.reload()).toMatchObject({ stage: "in_progress", needsAttention: true });
    expect(await s.t.runs.listActive(s.project.id)).toHaveLength(0);
  });
});
