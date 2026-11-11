import { InMemoryOAuthGrantStore, InMemoryQuotaStore, type QuotaStatus } from "@andy/contracts";
import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import type { ActionsClaims } from "./github/token";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { hashToken, newToken } from "./mcp/tokens";

/**
 * AI-74: Clear a quota idle, end to end in-process: a run reports a plausible but false high
 * reading, dispatch idles at the reserve, Andy clears it over MCP, dispatch resumes, and the next
 * real (lower) reading is believed. Only GitHub is faked.
 */

const MCP_URL = "https://cp.example/mcp";
const verify = async (jwt: string): Promise<ActionsClaims> => JSON.parse(jwt) as ActionsClaims;
const RESET_S = Math.floor(Date.now() / 1000) + 3600;
const limits = (five: number, seven: number) => ({
  unifiedWindows: {
    five_hour: { utilization: five, resetsAt: RESET_S },
    seven_day: { utilization: seven, resetsAt: RESET_S },
  },
});
const refineOutput = {
  summary: "**Ask**: a board",
  type: "feature",
  size: "S",
  sizeReason: "one screen",
  outOfScope: [],
  touches: [],
  questions: [],
};

async function setup() {
  const quota = new InMemoryQuotaStore();
  const grants = new InMemoryOAuthGrantStore();
  const t = githubApp(
    { verifyActionsToken: verify },
    {
      quota,
      mcp: { publicUrl: "https://cp.example", grants, clients: new ClientMetadataResolver() },
    },
  );
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
  const send = (path: string, method: string, body?: unknown) =>
    t.call(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const projectPath = `/api/projects/${project.id}`;
  for (const patch of [{ autoRefine: false }, { buildEnabled: true }, { autoBuild: true }]) {
    expect((await send(projectPath, "PATCH", patch)).status).toBe(200);
  }

  /** A refine run started by hand and reported with these rate limits. */
  const reportReading = async (title: string, rateLimits: unknown) => {
    const ticket = await t.tracker.createTicket(project.id, { type: "feature", title }, "andy");
    await t.tracker.updateTicket(
      project.id,
      ticket.id,
      { fields: { upNextRank: "0000000001" } },
      "andy",
    );
    const started = await send(`${projectPath}/tickets/${ticket.id}/runs`, "POST", {
      step: "refine",
    });
    expect(started.status).toBe(201);
    const run = await json<{ id: string; executor: { externalId: string } }>(started);
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
          status: "succeeded",
          summary: "{}",
          tokensIn: null,
          tokensOut: null,
          costUsd: null,
          output: refineOutput,
          rateLimits,
        }),
      },
      JSON.stringify(claims),
    );
    expect(res.status).toBe(200);
  };

  /** A ticket that meets the Definition of Ready, moved to Ready: dispatch decides on it. */
  const readyTicket = async () => {
    const ticket = await json<{ id: string }>(
      send(`${projectPath}/tickets`, "POST", {
        type: "feature",
        title: "Board",
        body: "Andy can't see his tickets.",
        acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
        size: "S",
        sizeReason: "one screen",
      }),
    );
    const path = `${projectPath}/tickets/${ticket.id}`;
    expect((await send(`${path}/stage`, "POST", { to: "ready" })).status).toBe(200);
    return { builds: async () => (await json<{ step: string }[]>(t.call(`${path}/runs`))).length };
  };

  const decision = async () =>
    (await json<{ lastDispatch: { decision: string } | null }>(t.call(projectPath))).lastDispatch
      ?.decision;

  const mcp = async () => {
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
    return client;
  };

  return { ...t, quota, project, json, send, reportReading, readyTicket, decision, mcp };
}

describe("clear a quota idle", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAFalseHighReadingIdlesDispatch_WhenAndyClearsItOverMcp_ThenDispatchResumesAndTheNextReadingIsBelieved", async () => {
    const { call, json, send, project, reportReading, readyTicket, decision, mcp } = await setup();

    // A run reports a plausible but false 5-hour reading of 95%: dispatch idles at the reserve.
    await reportReading("False high", limits(0.95, 0.2));
    const ticket = await readyTicket();
    expect(await decision()).toBe("quota_reserve");
    expect(await ticket.builds()).toBe(0);

    // Andy clears it over MCP: the reading is discarded with who and when, and dispatch resumes.
    const client = await mcp();
    const cleared = await client.callTool({ name: "clear_quota_idle", arguments: {} });
    expect(cleared.isError).toBeFalsy();
    expect(cleared.structuredContent).toMatchObject({
      cleared: [{ window: "5h", usedPct: 95, by: "andy@example.com" }],
    });
    expect(await ticket.builds()).toBe(1);
    expect(await decision()).not.toBe("quota_reserve");
    const unknown = await json<QuotaStatus>(call("/api/quota"));
    expect(unknown.windows.find((w) => w.window === "5h")?.level).toBe("unknown");

    // A second clear of the same reading is refused, over MCP and REST.
    const again = await client.callTool({ name: "clear_quota_idle", arguments: {} });
    expect(again.isError).toBe(true);
    expect((await send("/api/quota/clear", "POST")).status).toBe(409);

    // The next real reading, far lower, is accepted: no drop check against the discarded one.
    await reportReading("Real reading", limits(0.3, 0.2));
    const after = await json<QuotaStatus>(call("/api/quota"));
    expect(after.windows.find((w) => w.window === "5h")).toMatchObject({
      level: "ok",
      usedPct: 30,
    });

    // The clear shows in the digest's exceptions.
    const digest = await json<{ exceptions: { kind: string; reason: string }[] }>(
      call(`/api/projects/${project.id}/digest`),
    );
    expect(digest.exceptions).toContainEqual(
      expect.objectContaining({ kind: "quota_cleared", reason: expect.stringMatching(/95%/) }),
    );
  });

  it("GivenNoReadingAtTheReserve_WhenAndyClears_ThenRefusedWith409", async () => {
    const { send, reportReading } = await setup();
    await reportReading("Normal", limits(0.4, 0.2));
    const res = await send("/api/quota/clear", "POST");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/nothing to clear/) });
  });

  it("GivenNoSignIn_WhenClearIsPosted_ThenUnauthenticated", async () => {
    const { call } = await setup();
    expect((await call("/api/quota/clear", { method: "POST" }, null)).status).toBe(401);
  });
});
