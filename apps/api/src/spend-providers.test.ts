import {
  InMemoryConfigChangeStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemorySpendLedger,
  InMemoryWorkTracker,
  type SpendLedger,
} from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { ownerOnlyAccess, type ProjectAccess } from "./project-access";

/** AI-257: M10.9: paid spend by provider, read-only, over the ledger's per-provider totals. */

const NOW = new Date("2026-11-21T12:00:00.000Z");
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "andy") return { uid: "uid-1", email: "andy@example.com", emailVerified: true };
    throw new Error("bad token");
  },
};

async function setup(spendLedger?: SpendLedger, projectAccess: ProjectAccess = ownerOnlyAccess()) {
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ name: "AI", key: "AI" });
  await tracker.createProject({ name: "Web", key: "WEB" });
  const app = createApp({
    verifier,
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    configChanges: new InMemoryConfigChangeStore(),
    projectAccess,
    mcp: {
      publicUrl: "http://localhost",
      grants: new InMemoryOAuthGrantStore(),
      clients: new ClientMetadataResolver(),
      now: () => NOW,
    },
    ...(spendLedger ? { spendLedger } : {}),
  });
  const get = async (path: string) => {
    const res = await app.request(path, { headers: { authorization: "Bearer andy" } });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { get };
}

const entry = (n: number, projectId: string, provider: "openrouter" | "claude-sub") => ({
  id: `s${n}`,
  runId: `r${n}`,
  projectId,
  provider,
  model: "m",
  state: "reserved" as const,
  reservedMicroUsd: n * 1_000_000,
  settledMicroUsd: null,
  at: new Date().toISOString(),
  settledAt: null,
});
const none = {
  per_task: null,
  project_daily: null,
  project_monthly: null,
  global_daily: null,
  global_monthly: null,
};

describe("GET /api/projects/{projectId}/spend/providers", () => {
  it("GivenSpendOnTwoProvidersAndProjects_WhenRead_ThenProjectAndGlobalRowsPerProvider", async () => {
    const ledger = new InMemorySpendLedger();
    await ledger.reserve(entry(1, "ai", "openrouter"), none);
    await ledger.reserve(entry(2, "ai", "claude-sub"), none);
    await ledger.reserve(entry(3, "web", "openrouter"), none);
    const { get } = await setup(ledger);
    const { status, body } = await get("/api/projects/ai/spend/providers");
    expect(status).toBe(200);
    const day = (rows: unknown) =>
      Object.fromEntries(
        (rows as { provider: string; dayMicroUsd: number }[]).map((r) => [
          r.provider,
          r.dayMicroUsd,
        ]),
      );
    expect(day(body.project)).toEqual({
      "claude-sub": 2_000_000,
      "google-sub": 0,
      openrouter: 1_000_000,
    });
    expect(day(body.global)).toEqual({
      "claude-sub": 2_000_000,
      "google-sub": 0,
      openrouter: 4_000_000,
    });
  });

  it("GivenNoLedgerOrAnUnreadableOne_WhenRead_ThenUnknownNeverZero", async () => {
    expect((await (await setup()).get("/api/projects/ai/spend/providers")).body).toEqual({
      project: null,
      global: null,
    });
    const broken = Object.assign(new InMemorySpendLedger(), {
      totalsByProvider: async () => {
        throw new Error("ledger down");
      },
    });
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const { body } = await (await setup(broken)).get("/api/projects/ai/spend/providers");
    logs.mockRestore();
    expect(body).toEqual({ project: null, global: null });
  });

  it("GivenAnUnknownOrUnreadableProject_WhenRead_Then404", async () => {
    const { get } = await setup(new InMemorySpendLedger());
    expect((await get("/api/projects/nope/spend/providers")).status).toBe(404);
    const denied: ProjectAccess = { canRead: async (_a, id) => id !== "ai" };
    const other = await setup(new InMemorySpendLedger(), denied);
    expect((await other.get("/api/projects/ai/spend/providers")).status).toBe(404);
  });
});
