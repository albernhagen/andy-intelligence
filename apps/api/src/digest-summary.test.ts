import {
  InMemoryCodeEventLog,
  InMemoryCodeHostConnectionStore,
  InMemoryDigestSummaryStore,
  InMemoryOAuthGrantStore,
  InMemoryReleaseNoteStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type DigestSummaryOutput,
} from "@andy/contracts";
import { countReads } from "@andy/contracts/testing";
import { latestFinishedDay } from "@andy/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "./app";
import { parseAllowList } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";

/**
 * AI-323 (ADR-0137): the digest's summary over REST and MCP. A settled day costs the digest one
 * more read (the summary's point read); REST and MCP show the same summary; the retry route is
 * owner-only and refuses what can't be retried.
 */

const PUBLIC_URL = "https://cp.example";
const NOW = new Date("2026-11-22T15:00:00.000Z");
const DAY = latestFinishedDay(NOW);
const ROUTE = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;
const OUTPUT: DigestSummaryOutput = {
  summary: "Andy can now read a summary of the day.",
  summaryRefs: { tickets: ["AI-323"], prs: [349] },
  lines: [],
};

async function setup() {
  const tracker = new InMemoryWorkTracker(() => NOW);
  await tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: [] });
  const summaries = new InMemoryDigestSummaryStore();
  const stores = {
    tracker: countReads(tracker),
    runs: countReads(new InMemoryRunStore()),
    notes: countReads(new InMemoryReleaseNoteStore()),
    summaries: countReads(summaries),
  };
  const grants = new InMemoryOAuthGrantStore();
  const deps = (withSummaries: boolean): AppDeps => ({
    projectAccess: ownerOnlyAccess(),
    verifier: {
      async verify() {
        return { uid: "andy", email: "andy@example.com", emailVerified: true };
      },
    },
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker: stores.tracker.store,
    runs: stores.runs.store,
    releaseNotes: stores.notes.store,
    ...(withSummaries && { digestSummaries: stores.summaries.store }),
    github: {
      publicUrl: PUBLIC_URL,
      connections: new InMemoryCodeHostConnectionStore(),
      events: new InMemoryCodeEventLog(),
      now: () => NOW,
    },
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  const app = createApp(deps(true));
  const without = createApp(deps(false));
  const reads = () => Object.values(stores).reduce((n, s) => n + s.reads(), 0);
  const reset = () => Object.values(stores).forEach((s) => s.reset());
  const request = (target: typeof app, path: string, method = "GET") =>
    target.request(path, { method, headers: { authorization: "Bearer andy" } });
  const settle = async (status: "ready" | "failed") => {
    const at = NOW.toISOString();
    await summaries.claim("ai", DAY, 10, at);
    if (status === "failed") {
      await summaries.fail("ai", DAY.id, null, { reason: "run_failed", detail: null }, at);
      return;
    }
    const dispatch = { runId: "run-1", route: ROUTE, inputHash: "a".repeat(64), truncated: false };
    await summaries.dispatched("ai", DAY.id, dispatch, at);
    await summaries.complete("ai", DAY.id, "run-1", OUTPUT, at);
  };
  return { app, without, reads, reset, request, settle, grants, summaries };
}

describe("digest summary over REST and MCP (AI-323)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GivenASettledSummary_WhenTheDigestIsRead_ThenItCostsOneMoreReadThanWithout", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const s = await setup();
    await s.settle("ready");

    s.reset();
    const withSummary = await s.request(s.app, "/api/projects/ai/digest");
    const withReads = s.reads();
    s.reset();
    await s.request(s.without, "/api/projects/ai/digest");
    const withoutReads = s.reads();

    expect(withSummary.status).toBe(200);
    expect(withReads - withoutReads).toBe(1);
    const body = (await withSummary.json()) as { summary: { state: string; output: unknown } };
    expect(body.summary).toMatchObject({ state: "ready", output: OUTPUT });
  });

  it("GivenAReadySummary_WhenReadOverMcp_ThenTheSameSummaryLeadsTheText", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const s = await setup();
    await s.settle("ready");
    const call = await mcpCaller(s.app, s.grants, `${PUBLIC_URL}/mcp`);

    const mcp = await call("digest", { project: "AI" });
    const rest = (await (await s.request(s.app, "/api/projects/ai/digest")).json()) as {
      summary: unknown;
    };

    expect(mcp.isError).toBe(false);
    expect(mcp.data.summary).toEqual(rest.summary);
    expect(mcp.text.startsWith(`Summary of ${DAY.id} (model-written, sonnet):`)).toBe(true);
    expect(mcp.text).toContain("Andy can now read a summary of the day. [AI-323, #349]");
  });

  it("GivenNoSummaryWiring_WhenTheDigestIsRead_ThenSummaryIsNullAndRetryIs503", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const s = await setup();

    const body = (await (await s.request(s.without, "/api/projects/ai/digest")).json()) as {
      summary: unknown;
    };
    expect(body.summary).toBeNull();
    const retry = await s.request(s.without, "/api/projects/ai/digest/summary/retry", "POST");
    expect(retry.status).toBe(503);
  });

  it("GivenAReadySummary_WhenRetried_ThenRefusedAs409", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const s = await setup();
    await s.settle("ready");

    const res = await s.request(s.app, "/api/projects/ai/digest/summary/retry", "POST");

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      `the ${DAY.id} summary can't be retried: it hasn't failed`,
    );
  });

  it("GivenAFailedSummary_WhenRetriedOverMcp_ThenItRunsAgain", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const s = await setup();
    await s.settle("failed");
    const call = await mcpCaller(s.app, s.grants, `${PUBLIC_URL}/mcp`);

    const retried = await call("retry_digest_summary", { project: "AI" });

    // Nothing was merged or changed that day, so the retry records that instead of a task.
    expect(retried.isError).toBe(false);
    expect(retried.data).toMatchObject({ state: "failed", canRetry: false });
    expect((await s.summaries.get("ai", DAY.id))?.attempts).toBe(2);
  });
});
