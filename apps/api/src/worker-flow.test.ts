import { InMemoryOAuthGrantStore } from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_URL, REPO, createdApp, githubApp } from "./github/test-app";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { hashToken, newToken } from "./mcp/tokens";

/**
 * AI-32: Who does the work, end to end in-process: the real API, domain, dispatcher and MCP, with
 * only GitHub faked. Andy's Ready ticket starts nothing until he gives it to an agent over MCP.
 */

const RESOURCE = `${PUBLIC_URL}/mcp`;

async function setup() {
  const grants = new InMemoryOAuthGrantStore();
  const t = githubApp(
    {},
    { mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() } },
  );
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const token = newToken();
  await grants.put(hashToken(token), {
    kind: "access",
    clientId: "https://claude.ai/oauth/mcp-client-metadata",
    email: "andy@example.com",
    uid: "andy",
    resource: RESOURCE,
    scope: "",
    redirectUri: null,
    codeChallenge: null,
    expiresAt: "2999-01-01T00:00:00.000Z",
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(RESOURCE), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (input, init) =>
        t.app.fetch(input instanceof Request ? input : new Request(input, init)),
    }),
  );
  const tool = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError ?? false).toBe(false);
    return result.structuredContent as Record<string, unknown>;
  };
  const send = async <T>(path: string, method: string, body?: unknown) => {
    const res = await t.call(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  return { t, tool, send };
}

async function readyTicket(s: Awaited<ReturnType<typeof setup>>, defaultWorker: "me" | "ask") {
  const { body: project } = await s.send<{ id: string }>("/api/projects", "POST", {
    name: "AI",
    key: "AI",
    repos: [REPO],
  });
  const projectPath = `/api/projects/${project.id}`;
  await s.send(projectPath, "PATCH", { autoRefine: false });
  await s.send(projectPath, "PATCH", { buildEnabled: true });
  await s.send(projectPath, "PATCH", { autoBuild: true });
  await s.tool("set_default_worker", { project: "AI", worker: defaultWorker });
  const { body: ticket } = await s.send<{ id: string; key: string }>(
    `${projectPath}/tickets`,
    "POST",
    {
      type: "feature",
      title: "Board",
      body: "Andy can't see his tickets.",
      acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
      size: "S",
      sizeReason: "one screen",
    },
  );
  const path = `${projectPath}/tickets/${ticket.id}`;
  await s.send(`${path}/stage`, "POST", { to: "ready" });
  return { key: ticket.key, path, projectPath };
}

describe("worker flow", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAMeDefaultProject_WhenATicketIsReady_ThenNothingStartsUntilAndyGivesItToAnAgentOverMcp", async () => {
    const s = await setup();
    const { key, path, projectPath } = await readyTicket(s, "me");

    expect((await s.send<unknown[]>(`${path}/runs`, "GET")).body).toEqual([]);
    expect(await s.tool("status", { ticket: key })).toMatchObject({ worker: "me" });
    expect((await s.send(`${path}/runs`, "POST", { step: "build" })).status).toBe(422);
    expect(
      (await s.send<{ summary: { worker: string } }[]>(`${projectPath}/board`, "GET")).body[0],
    ).toMatchObject({ summary: { worker: "me" } });
    expect((await s.tool("list_needs_me", {})).tickets).toEqual([]);

    expect(await s.tool("set_worker", { ticket: key, worker: "agent" })).toMatchObject({
      ticket: key,
      worker: "agent",
      override: "agent",
      projectDefault: "me",
    });

    const runs = await s.send<{ step: string }[]>(`${path}/runs`, "GET");
    expect(runs.body).toMatchObject([{ step: "build" }]);
    expect((await s.send<{ stage: string }>(path, "GET")).body.stage).toBe("in_progress");
  });

  it.each(["me", "ask"] as const)(
    "GivenADefaultOf%s_WhenTheDefaultBecomesAgent_ThenTheWaitingReadyTicketStarts",
    async (from) => {
      const s = await setup();
      const { path } = await readyTicket(s, from);
      expect((await s.send<unknown[]>(`${path}/runs`, "GET")).body).toEqual([]);

      await s.tool("set_default_worker", { project: "AI", worker: "agent" });

      expect((await s.send<unknown[]>(`${path}/runs`, "GET")).body).toMatchObject([
        { step: "build" },
      ]);
    },
  );

  it("GivenAnAskProject_WhenATicketIsReady_ThenNothingStartsAndClearingAPickFollowsTheDefault", async () => {
    const s = await setup();
    const { key, path } = await readyTicket(s, "ask");

    expect((await s.send<unknown[]>(`${path}/runs`, "GET")).body).toEqual([]);
    expect((await s.send(`${path}/worker`, "GET")).body).toEqual({
      worker: "ask",
      override: null,
      projectDefault: "ask",
    });

    await s.tool("set_worker", { ticket: key, worker: "me" });
    expect(await s.tool("set_worker", { ticket: key, worker: null })).toMatchObject({
      worker: "ask",
      override: null,
    });
    expect((await s.send<unknown[]>(`${path}/runs`, "GET")).body).toEqual([]);
  });
});
