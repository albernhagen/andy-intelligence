import {
  DEFAULT_SPEND_CAPS,
  InMemoryConfigChangeStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemorySpendCapsStore,
  InMemoryWorkTracker,
  type SpendCapsStore,
} from "@andy/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";

/** AI-276: the global spend caps over REST and MCP: store, edit, change log, revert. */

const PUBLIC_URL = "http://localhost";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "andy") return { uid: "uid-1", email: "andy@example.com", emailVerified: true };
    if (token === "eve") return { uid: "uid-2", email: "eve@example.com", emailVerified: true };
    throw new Error("bad token");
  },
};

async function setup(spendCapsStore: SpendCapsStore | null = new InMemorySpendCapsStore()) {
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ name: "AI", key: "AI" });
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    verifier,
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    configChanges: new InMemoryConfigChangeStore(),
    projectAccess: ownerOnlyAccess(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    ...(spendCapsStore ? { spendCapsStore } : {}),
  });
  const call = async (method: string, path: string, body?: unknown, token = "andy") => {
    const res = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const mcp = () => mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
  return { call, tracker, mcp };
}

const lowerDaily = (dailyMicroUsd: number) => ({ ...DEFAULT_SPEND_CAPS, dailyMicroUsd });

describe("global spend caps routes (AI-276)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("GivenNothingStored_WhenRead_ThenTheDefaults", async () => {
    const { call } = await setup();
    expect((await call("GET", "/api/spend-caps")).json).toEqual({
      caps: DEFAULT_SPEND_CAPS,
      source: "default",
      updatedAt: null,
    });
  });

  it("GivenTheDefaults_WhenTheOwnerSaves_ThenStoredShownOnProjectsAndLogged", async () => {
    const { call } = await setup();
    const saved = await call("PUT", "/api/spend-caps", {
      caps: lowerDaily(3_000_000),
      ifUpdatedAt: null,
      reason: "tighter",
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ source: "stored", caps: { dailyMicroUsd: 3_000_000 } });

    const project = (await call("GET", "/api/projects/ai/spend")).json;
    expect(project.global).toMatchObject({ source: "stored", caps: { dailyMicroUsd: 3_000_000 } });
    expect(project.effective.project_daily).toBe(3_000_000);

    const [change] = (await call("GET", "/api/spend-caps/changes")).json;
    expect(change).toMatchObject({
      entity: "spend-caps",
      projectId: null,
      reason: "tighter",
      diff: { dailyMicroUsd: { from: 5_000_000, to: 3_000_000 } },
    });
  });

  it("GivenAStaleRead_WhenSaving_Then409AndNothingChanges", async () => {
    const { call } = await setup();
    const first = (
      await call("PUT", "/api/spend-caps", { caps: lowerDaily(3_000_000), ifUpdatedAt: null })
    ).json;
    await call("PUT", "/api/spend-caps", {
      caps: lowerDaily(2_000_000),
      ifUpdatedAt: first.updatedAt,
    });
    const stale = await call("PUT", "/api/spend-caps", {
      caps: lowerDaily(1_000_000),
      ifUpdatedAt: first.updatedAt,
    });
    expect(stale.status).toBe(409);
    expect((await call("GET", "/api/spend-caps")).json.caps.dailyMicroUsd).toBe(2_000_000);
  });

  it("GivenALoweredGlobal_WhenAProjectCapAboveItIsSet_Then422", async () => {
    const { call } = await setup();
    await call("PUT", "/api/spend-caps", { caps: lowerDaily(3_000_000), ifUpdatedAt: null });
    const res = await call("PUT", "/api/projects/ai/spend-caps", {
      caps: { dailyMicroUsd: 4_000_000 },
    });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("above the global daily cap $3.00");
  });

  it("GivenASave_WhenRevertedFromTheLog_ThenTheDefaultsAreBackAndTheRevertIsLogged", async () => {
    const { call } = await setup();
    await call("PUT", "/api/spend-caps", { caps: lowerDaily(3_000_000), ifUpdatedAt: null });
    const [change] = (await call("GET", "/api/spend-caps/changes")).json;
    const res = await call("POST", `/api/spend-caps/changes/${change.id}/revert`);
    expect(res.status).toBe(200);
    expect(res.json.global.caps).toEqual(DEFAULT_SPEND_CAPS);
    expect(res.json.reverted).toMatchObject({ id: change.id, status: "reverted" });
    expect(await (await call("GET", "/api/spend-caps/changes")).json).toHaveLength(2);
  });

  it.each([
    ["a fraction", lowerDaily(1.5)],
    ["a negative", lowerDaily(-1)],
  ])("GivenACapThatIs%s_WhenSaved_Then400", async (_, caps) => {
    const { call } = await setup();
    expect((await call("PUT", "/api/spend-caps", { caps, ifUpdatedAt: null })).status).toBe(400);
  });

  it("GivenSomeoneNotOnTheAllowList_WhenSaving_ThenRefusedAndNothingStored", async () => {
    const store = new InMemorySpendCapsStore();
    const { call } = await setup(store);
    const res = await call(
      "PUT",
      "/api/spend-caps",
      { caps: lowerDaily(0), ifUpdatedAt: null },
      "eve",
    );
    expect(res.status).toBe(403);
    expect(await store.getGlobal()).toBeNull();
  });

  it("GivenNoStoreConfigured_WhenSaving_Then422AndReadsShowTheDefaults", async () => {
    const { call } = await setup(null);
    expect((await call("GET", "/api/spend-caps")).json.source).toBe("default");
    const res = await call("PUT", "/api/spend-caps", { caps: lowerDaily(0), ifUpdatedAt: null });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("isn't configured");
  });

  it("GivenAnUnreadableStore_WhenAProjectsSpendIsRead_ThenAnErrorNotTheDefaults", async () => {
    const { call } = await setup({
      getGlobal: () => Promise.reject(new Error("down")),
      putGlobal: () => Promise.reject(new Error("down")),
    });
    const res = await call("GET", "/api/projects/ai/spend");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.json ?? {})).not.toContain("5000000");
  });
});

describe("global spend caps MCP tools (AI-276)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("GivenStoredCaps_WhenSetGlobalSpendCapsGivesOneCap_ThenTheOthersStayAndItIsLogged", async () => {
    const { mcp } = await setup();
    const caller = await mcp();
    await caller("set_global_spend_caps", { perTaskMicroUsd: 1_000_000 });
    const { isError, data } = await caller("set_global_spend_caps", {
      dailyMicroUsd: 3_000_000,
      reason: "tighter",
    });
    expect(isError).toBe(false);
    expect(data).toMatchObject({
      source: "stored",
      caps: { dailyMicroUsd: 3_000_000, perTaskMicroUsd: 1_000_000, monthlyMicroUsd: 50_000_000 },
      capsUsd: { dailyMicroUsd: "$3.00", perTaskMicroUsd: "$1.00" },
    });
    const { data: log } = await caller("list_spend_cap_changes");
    expect(log.changes).toHaveLength(2);
    expect(log.changes[0]).toMatchObject({ reason: "tighter" });
  });

  it("GivenAChange_WhenRevertSpendCapChangeIsCalled_ThenTheCapIsBack", async () => {
    const { mcp, call } = await setup();
    const caller = await mcp();
    await caller("set_global_spend_caps", { dailyMicroUsd: 3_000_000 });
    const { data: log } = await caller("list_spend_cap_changes");
    const { isError } = await caller("revert_spend_cap_change", { change: log.changes[0].id });
    expect(isError).toBe(false);
    expect((await call("GET", "/api/spend-caps")).json.caps).toEqual(DEFAULT_SPEND_CAPS);
  });
});
