import {
  InMemoryDeploymentStore,
  InMemoryOAuthGrantStore,
  InMemoryReleaseRequestStore,
  InMemoryWatchdogQueue,
  type NewDeployment,
  type ReleaseRequest,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, githubApp } from "./github/test-app";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";

/** AI-199: M6.12: promote and rollback over the API and MCP share one service. */

const MCP_URL = "https://cp.example/mcp";
const digest = (c: string) => `sha256:${c.repeat(64)}`;
const sha = (c: string) => c.repeat(40);
type Result = { request: ReleaseRequest; summary: string };

describe("Promote and rollback API and MCP (AI-199: M6.12)", () => {
  let t: ReturnType<typeof githubApp>;
  let deployments: InMemoryDeploymentStore;
  let requests: InMemoryReleaseRequestStore;
  let queue: InMemoryWatchdogQueue;
  let grants: InMemoryOAuthGrantStore;
  let minute = 0;

  const deploy = async (overrides: Partial<NewDeployment>) => {
    minute += 1;
    const at = new Date(Date.parse("2026-11-26T09:00:00.000Z") + minute * 60_000).toISOString();
    return deployments.record({
      projectId: "ai",
      environment: "prod",
      imageDigest: digest("a"),
      gitSha: sha("a"),
      kind: "deploy",
      status: "succeeded",
      startedAt: at,
      finishedAt: at,
      actor: "system",
      ...overrides,
    });
  };
  const post = (path: string, body: unknown, token: string | null = "andy") =>
    t.call(path, { method: "POST", body: JSON.stringify(body) }, token);
  const runs = () => [...t.host.workflowRuns.values()];

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    deployments = new InMemoryDeploymentStore();
    requests = new InMemoryReleaseRequestStore();
    queue = new InMemoryWatchdogQueue();
    grants = new InMemoryOAuthGrantStore();
    t = githubApp(
      {},
      {
        deployments,
        releaseRequests: requests,
        mcp: { publicUrl: "https://cp.example", grants, clients: new ClientMetadataResolver() },
        watchdog: {
          queue,
          publicUrl: "https://cp.example",
          invokerEmail: "tasks-invoker@p.iam.gserviceaccount.com",
          verifyInvokerToken: async (jwt) => {
            if (jwt !== "invoker") throw new Error("bad token");
          },
        },
      },
    );
    await t.connections.save({
      appId: "1",
      slug: "andy-intelligence",
      clientId: "Iv1",
      owner: "albernhagen",
      privateKey: "PEM",
      webhookSecret: "whs",
      connectedAt: "2026-11-03T00:00:00.000Z",
    });
    const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
    await t.tracker.updateProject(project.id, {
      deployKind: "cloud-run",
      environments: "dev-and-prod",
    });
    await deploy({ environment: "dev", imageDigest: digest("b"), gitSha: sha("b") });
    await deploy({ revision: "control-plane-00001" });
    await deploy({ revision: "control-plane-00002", imageDigest: digest("c") });
  });

  it("GivenTheOwner_WhenPromotingOverTheApi_ThenReleaseYmlIsDispatchedWithTheLatestDevDigest", async () => {
    const res = await post("/api/projects/ai/releases/promote", {});
    expect(res.status).toBe(202);
    const body = (await res.json()) as Result;
    expect(runs().map((r) => [r.workflow, r.inputs])).toEqual([
      [
        "release.yml",
        {
          action: "promote",
          environment: "prod",
          digest: digest("b"),
          revision: "",
          request: body.request.id,
        },
      ],
    ]);
    expect(body.request).toMatchObject({ status: "dispatched", actor: "user:andy" });
    expect(body.summary).toContain("prod will serve");
    expect([...queue.queued.values()][0]).toMatchObject({ kind: "release" });
  });

  it("GivenTheOwner_WhenRollingBackOverMcpWithTheDefault_ThenThePreviousSucceededRevisionIsSent", async () => {
    const mcp = await mcpCaller(t.app, grants, MCP_URL);
    const result = await mcp("rollback", { project: "AI" });
    expect(result.isError).toBe(false);
    expect((result.data as Result).request.revision).toBe("control-plane-00001");
    expect(runs()[0]?.inputs).toMatchObject({
      action: "rollback",
      environment: "prod",
      revision: "control-plane-00001",
    });
  });

  it("GivenAPromoteJustAsked_WhenRollbackIsAskedWithinAMinute_Then429AndOneRun", async () => {
    expect((await post("/api/projects/ai/releases/promote", {})).status).toBe(202);
    const second = await post("/api/projects/ai/releases/rollback", {});
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: string }).error).toContain("per minute");
    const mcp = await mcpCaller(t.app, grants, MCP_URL);
    expect((await mcp("promote", { project: "AI" })).isError).toBe(true);
    expect(runs()).toHaveLength(1);
  });

  it("GivenASignedInUserWhoIsNotTheOwner_WhenPromotingOrRollingBack_Then403AndNothingDispatched", async () => {
    expect((await post("/api/projects/ai/releases/promote", {}, "stranger")).status).toBe(403);
    expect((await post("/api/projects/ai/releases/rollback", {}, "stranger")).status).toBe(403);
    expect((await post("/api/projects/ai/releases/promote", {}, null)).status).toBe(401);
    expect(runs()).toEqual([]);
    expect(await requests.list("ai")).toEqual([]);
  });

  it("GivenDeployKindNone_WhenPromotingOrRollingBack_Then409SayingWhy", async () => {
    await t.tracker.updateProject("ai", { deployKind: "none" });
    for (const path of [
      "/api/projects/ai/releases/promote",
      "/api/projects/ai/releases/rollback",
    ]) {
      const res = await post(path, {});
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain("deploy kind none");
    }
    expect(runs()).toEqual([]);
  });

  it("GivenAProdOnlyProject_WhenPromoting_Then409ButRollbackWorks", async () => {
    await t.tracker.updateProject("ai", { environments: "prod-only" });
    expect((await post("/api/projects/ai/releases/promote", {})).status).toBe(409);
    expect((await post("/api/projects/ai/releases/rollback", {})).status).toBe(202);
  });

  it("GivenAnUnknownDigestOrRevision_WhenAsked_Then422", async () => {
    const promote = await post("/api/projects/ai/releases/promote", { digest: digest("f") });
    expect(promote.status).toBe(422);
    const rollback = await post("/api/projects/ai/releases/rollback", { revision: "nope" });
    expect(rollback.status).toBe(422);
    expect((await post("/api/projects/ai/releases/rollback", { revision: 7 })).status).toBe(400);
  });

  it("GivenTheAppLacksActionsWrite_WhenPromoting_Then502SayingSoAndTheRequestRecordsIt", async () => {
    t.host.failDispatch = Object.assign(new Error("Resource not accessible by integration"), {
      status: 403,
    });
    const res = await post("/api/projects/ai/releases/promote", {});
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("actions: write");
    const listed = await t.call("/api/projects/ai/releases/requests");
    const { requests: list } = (await listed.json()) as { requests: ReleaseRequest[] };
    expect(list.map((r) => r.status)).toEqual(["dispatch_failed"]);
  });

  it("GivenARequest_WhenListedOverTheApiAndMcp_ThenTheSameRequests", async () => {
    await post("/api/projects/ai/releases/promote", {});
    const route = (await (await t.call("/api/projects/ai/releases/requests")).json()) as {
      requests: ReleaseRequest[];
    };
    const mcp = await mcpCaller(t.app, grants, MCP_URL);
    const result = await mcp("list_release_requests", { project: "AI" });
    const { text, ...data } = result.data as { requests: ReleaseRequest[]; text: string };
    expect(data).toEqual(route);
    expect(result.text).toBe(text);
    expect(text).toContain("AI release requests: 1, newest first.");
    expect(text).toContain("promote prod → sha256:bbbbbbbbbbbb: dispatched");
  });

  it("GivenTheRunWasCancelled_WhenTheQueuedCheckArrives_ThenTheRequestIsCancelled", async () => {
    const { request } = (await (
      await post("/api/projects/ai/releases/promote", {})
    ).json()) as Result;
    const entry = t.host.workflowRuns.get(request.runId!)!;
    entry.run = { ...entry.run, status: "completed", conclusion: "cancelled" };
    const path = `/projects/ai/release-requests/${request.id}/check`;
    expect((await t.call(path, { method: "POST" }, null)).status).toBe(401);
    const res = await t.call(path, { method: "POST" }, "invoker");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "cancelled" });
    expect((await requests.get(request.id))?.status).toBe("cancelled");
  });
});
