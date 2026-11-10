import { InMemoryOAuthGrantStore, type Digest } from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { REPO, githubApp } from "./github/test-app";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { hashToken, newToken } from "./mcp/tokens";

/** AI-70: the daily digest end to end in-process: seeded stores → REST and MCP. */

const MCP_URL = "https://cp.example/mcp";
const ROUTE = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;

async function setup() {
  const grants = new InMemoryOAuthGrantStore();
  const t = githubApp(
    {},
    { mcp: { publicUrl: "https://cp.example", grants, clients: new ClientMetadataResolver() } },
  );
  const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const ticket = (title: string) =>
    t.tracker.createTicket(project.id, { type: "feature", title }, "andy");
  const finish = async (ticketId: string, patch: object) => {
    const run = await t.runs.create({
      projectId: project.id,
      ticketId,
      step: "build",
      route: ROUTE,
      tier: null,
    });
    return t.runs.update(run.id, { endedAt: new Date().toISOString(), ...patch }, ["queued"]);
  };

  const failing = await ticket("Flaky build");
  await finish(failing.id, { status: "failed", error: "no report by the deadline" });

  const shipped = await ticket("Shipped feature");
  const url = "https://github.com/o/r/pull/12";
  await finish(shipped.id, { status: "succeeded", costUsd: 2.5, links: { pullRequest: url } });
  await t.tracker.linkPullRequest(
    project.id,
    shipped.id,
    { number: 12, url, state: "merged" },
    "system",
  );

  const asking = await ticket("Needs an answer");
  await t.tracker.askQuestion(project.id, asking.id, { text: "Which way?" }, "andy");

  await t.tracker.updateProject(project.id, { paused: true });

  const mcpDigest = async (args: object) => {
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
    const result = await client.callTool({ name: "digest", arguments: { project: "AI", ...args } });
    const [first] = result.content as { type: string; text: string }[];
    return { digest: result.structuredContent as Digest, text: first!.text };
  };

  return { ...t, project, failing, shipped, asking, mcpDigest };
}

describe("daily digest", () => {
  it("GivenASeededProject_WhenReadOverApiAndMcp_ThenExceptionsMergedAndTotalsInOrder", async () => {
    const { call, mcpDigest, failing, shipped, asking } = await setup();

    const res = await call("/api/projects/ai/digest");
    expect(res.status).toBe(200);
    const digest = (await res.json()) as Digest;

    expect(digest.quiet).toBe(false);
    expect(digest.exceptions.map((e) => [e.kind, e.ticketKey, e.reason])).toEqual([
      ["run_failed", failing.key, "Build run failed: no report by the deadline"],
      ["waiting_on_andy", asking.key, "Waiting for you: 1 question"],
      ["dispatch_idle", null, "Dispatch is paused"],
    ]);
    expect(digest.merged).toEqual([
      expect.objectContaining({
        ticketKey: shipped.key,
        prNumber: 12,
        mergedBy: "andy",
        costUsd: 2.5,
      }),
    ]);
    expect(digest.totals).toMatchObject({ runs: 2, failedRuns: 1, costUsd: 2.5, merged: 1 });

    const text = digest.text;
    expect(text.indexOf("Exceptions (3)")).toBeLessThan(text.indexOf("Merged (1)"));
    expect(text.indexOf("Merged (1)")).toBeLessThan(text.indexOf("Totals"));

    const mcp = await mcpDigest({});
    expect(mcp.text).toBe(digest.text);
    expect(mcp.digest.exceptions).toEqual(digest.exceptions);
    expect(mcp.digest.totals).toEqual(digest.totals);
  });

  it("GivenTheSameSeedAndAPastWindow_WhenRead_ThenOneLineNothingHappened", async () => {
    const { call, mcpDigest } = await setup();
    const until = "2026-01-01T00:00:00.000Z";

    const res = await call(`/api/projects/ai/digest?hours=24&until=${until}`);
    const digest = (await res.json()) as Digest;
    expect(digest.quiet).toBe(true);
    expect(digest.text).toBe(
      "AI digest · 2025-12-31 00:00 UTC to 2026-01-01 00:00 UTC: nothing happened.",
    );

    expect((await mcpDigest({ until })).text).toBe(digest.text);
  });

  it("GivenABadWindowOrProject_WhenRead_Then400Or404", async () => {
    const { call } = await setup();
    expect((await call("/api/projects/ai/digest?hours=0")).status).toBe(400);
    expect((await call("/api/projects/ai/digest?hours=169")).status).toBe(400);
    expect((await call("/api/projects/zz/digest")).status).toBe(404);
  });
});
