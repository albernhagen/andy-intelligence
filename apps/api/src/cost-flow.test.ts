import { InMemoryOAuthGrantStore, InMemoryQuotaStore, type TicketCost } from "@andy/contracts";
import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import type { ActionsClaims } from "./github/token";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { hashToken, newToken } from "./mcp/tokens";

/** AI-67: Cost per run, end to end in-process: report → stored run → REST and MCP totals. */

const MCP_URL = "https://cp.example/mcp";
const verify = async (jwt: string): Promise<ActionsClaims> => JSON.parse(jwt) as ActionsClaims;
const RESET_S = Math.floor(Date.now() / 1000) + 3600;
const limits = (five: number, seven: number) => ({
  unifiedWindows: {
    five_hour: { utilization: five, resetsAt: RESET_S },
    seven_day: { utilization: seven, resetsAt: RESET_S },
  },
});
const usage = {
  inputTokens: 1_000_000,
  outputTokens: 100_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 3,
  wallMs: 90_000,
};
interface RunBody {
  id: string;
  costUsd: number | null;
  costIsEstimate: boolean;
  usage: unknown;
  quotaDelta: unknown;
  executor: { externalId: string };
}

async function setup() {
  const quota = new InMemoryQuotaStore();
  const grants = new InMemoryOAuthGrantStore();
  const t = githubApp(
    { verifyActionsToken: verify },
    {
      quota,
      mcp: {
        publicUrl: "https://cp.example",
        grants,
        clients: new ClientMetadataResolver(),
      },
    },
  );
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const ticket = await t.tracker.createTicket(project.id, { type: "feature", title: "B" }, "andy");
  await t.tracker.updateTicket(
    project.id,
    ticket.id,
    { fields: { upNextRank: "0000000001" } },
    "andy",
  );
  const runsPath = `/api/projects/${project.id}/tickets/${ticket.id}/runs`;

  const startRun = async (): Promise<RunBody> => {
    const started = await t.call(runsPath, {
      method: "POST",
      body: JSON.stringify({ step: "refine" }),
    });
    expect(started.status).toBe(201);
    return (await started.json()) as RunBody;
  };

  /** A failed report: the failure's automatic retry gives the ticket its second run. */
  const report = async (run: RunBody, extra: object): Promise<void> => {
    const claims: ActionsClaims = {
      repository: REPO,
      workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
      job_workflow_ref: CLAUDE_EXECUTOR_REF,
      run_id: run.executor.externalId,
    };
    const res = await t.call(
      `/runs/${run.id}/report`,
      {
        method: "POST",
        body: JSON.stringify({
          status: "failed",
          summary: "stopped",
          tokensIn: null,
          tokensOut: null,
          costUsd: null,
          ...extra,
        }),
      },
      JSON.stringify(claims),
    );
    expect(res.status).toBe(200);
  };

  const mcpStatus = async (): Promise<{ cost: TicketCost }> => {
    const token = newToken();
    await grants.put(hashToken(token), {
      kind: "access",
      clientId: "https://claude.ai/oauth/mcp-client-metadata",
      email: "andy@example.com",
      uid: "andy",
      resource: MCP_URL,
      scope: "",
      redirectUri: null,
      codeChallenge: null,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    const client = new Client({ name: "test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
        fetch: async (input, init) =>
          t.app.fetch(input instanceof Request ? input : new Request(input, init)),
      }),
    );
    const result = await client.callTool({ name: "status", arguments: { ticket: ticket.key } });
    return result.structuredContent as { cost: TicketCost };
  };

  return { ...t, project, ticket, runsPath, startRun, report, mcpStatus };
}

describe("cost per run", () => {
  it("GivenARunWithUsageAndOneWithout_WhenTheTicketIsRead_ThenApiAndMcpShowTheTotal", async () => {
    const { call, project, runs, ticket, runsPath, startRun, report, mcpStatus } = await setup();

    await report(await startRun(), { rateLimits: limits(0.1, 0.2) }); // no earlier reading
    const [retry] = await runs.listActive(project.id);
    await report(retry as unknown as RunBody, {
      usage,
      costUsd: 9,
      rateLimits: limits(0.15, 0.21),
    });

    const stored = (await (await call(runsPath)).json()) as RunBody[];
    expect(stored).toHaveLength(2);
    expect(stored.find((r) => r.id === retry!.id)).toMatchObject({
      costUsd: 3,
      costIsEstimate: true,
      usage,
      quotaDelta: { "5h": 5, weekly: 1 },
    });
    expect(stored.find((r) => r.id !== retry!.id)).toMatchObject({
      costUsd: null,
      usage: null,
      quotaDelta: null,
    });

    const cost: TicketCost = {
      estimatedCostUsd: 3,
      quotaDelta: { "5h": 5, weekly: 1 },
      completedRuns: 2,
      unknownRuns: 1,
    };
    const byKey = (await (await call(`/api/tickets/${ticket.key}`)).json()) as { cost: TicketCost };
    expect(byKey.cost).toEqual(cost);
    expect((await mcpStatus()).cost).toEqual(cost);
  });

  it("GivenAGarbledUsage_WhenReported_ThenTheReportIsKeptAndTheCostUnknown", async () => {
    const { runs, startRun, report } = await setup();
    const run = await startRun();
    await report(run, { usage: { inputTokens: "lots" } });
    expect(await runs.get(run.id)).toMatchObject({ costUsd: null, usage: null });
  });
});
