import { InMemoryOAuthGrantStore } from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_URL, REPO, createdApp, githubApp } from "./github/test-app";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { hashToken, newToken } from "./mcp/tokens";

/**
 * AI-79 (ADR-0089 slice 2): where a ticket's runs execute, end to end in-process: the real API,
 * domain and MCP, with only GitHub faked. Andy sets the executor in REST and over MCP and sees
 * it in `status`, the project settings and the status line.
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

async function readyTicket(s: Awaited<ReturnType<typeof setup>>) {
  const { body: project } = await s.send<{ id: string }>("/api/projects", "POST", {
    name: "AI",
    key: "AI",
    repos: [REPO],
  });
  const projectPath = `/api/projects/${project.id}`;
  await s.send(projectPath, "PATCH", { autoRefine: false });
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

describe("executor flow", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAReadyTicket_WhenAndySetsItToLocalOverMcp_ThenStatusAndRestShowIt", async () => {
    const s = await setup();
    const { key, path } = await readyTicket(s);
    expect((await s.send(`${path}/executor`, "GET")).body).toEqual({
      executor: "actions",
      override: null,
      projectDefault: "actions",
      next: "actions",
      runnerPresent: false,
    });

    expect(await s.tool("set_executor", { ticket: key, executor: "local" })).toEqual({
      ticket: key,
      executor: "local",
      override: "local",
      projectDefault: "actions",
      next: "wait",
      runnerPresent: false,
    });

    const status = await s.tool("status", { ticket: key });
    expect(status).toMatchObject({
      ticket: { overrides: { executor: "local" } },
      executor: { executor: "local", override: "local" },
    });
    // No runner registered: the override waits for one (ADR-0089).
    expect((status.statusLine as { text: string }).text).toBe("Waiting: local runner away");
  });

  it("GivenALocalOverride_WhenAndyClearsItOverRest_ThenItFollowsTheProjectDefault", async () => {
    const s = await setup();
    const { key, path } = await readyTicket(s);
    await s.tool("set_executor", { ticket: key, executor: "local" });

    const cleared = await s.send(`${path}/executor`, "PUT", { executor: null });

    expect(cleared).toEqual({
      status: 200,
      body: {
        executor: "actions",
        override: null,
        projectDefault: "actions",
        next: "actions",
        runnerPresent: false,
      },
    });
  });

  it("GivenAProject_WhenAndySetsItsDefaultToLocalOverMcp_ThenSettingsAndTicketsFollow", async () => {
    const s = await setup();
    const { path } = await readyTicket(s);

    expect(await s.tool("set_default_executor", { project: "AI", executor: "local" })).toEqual({
      project: "AI",
      executor: "local",
    });

    expect(await s.tool("get_project_settings", { project: "AI" })).toMatchObject({
      executor: "local",
    });
    // No runner present: a project default of local falls back to Actions.
    expect((await s.send(`${path}/executor`, "GET")).body).toEqual({
      executor: "local",
      override: null,
      projectDefault: "local",
      next: "actions",
      runnerPresent: false,
    });
  });
});
