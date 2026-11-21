import {
  DEFAULT_SPEND_CAPS,
  InMemoryConfigChangeStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemorySpendLedger,
  InMemoryWorkTracker,
  type SpendLedger,
} from "@andy/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";

/** AI-249: M10.8: spend caps settings over REST and MCP, with the change log behind them. */

const PUBLIC_URL = "http://localhost";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "andy") return { uid: "uid-1", email: "andy@example.com", emailVerified: true };
    if (token === "eve") return { uid: "uid-2", email: "eve@example.com", emailVerified: true };
    throw new Error("bad token");
  },
};

/** The in-memory ledger with fixed totals: `project` for any project, `global` with none. */
const ledger = (project: number, global: number): SpendLedger =>
  Object.assign(new InMemorySpendLedger(), {
    totals: async (scope: { projectId?: string }) => {
      const day = scope.projectId ? project : global;
      return { day: "2026-11-21", dayMicroUsd: day, month: "2026-11", monthMicroUsd: day * 10 };
    },
  });

async function setup(spendLedger?: SpendLedger, projectAccess = ownerOnlyAccess()) {
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
    projectAccess,
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    ...(spendLedger ? { spendLedger } : {}),
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

describe("spend caps routes (AI-249)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("GivenANewProject_WhenSpendIsRead_ThenGlobalDefaultsNoOwnCapsAndEffectiveIsGlobal", async () => {
    const { call } = await setup(ledger(0, 0));
    const res = await call("GET", "/api/projects/ai/spend");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      global: { caps: DEFAULT_SPEND_CAPS, source: "default" },
      project: {},
      effective: { project_daily: 5_000_000, per_task: 2_000_000 },
      spent: { project: { dayMicroUsd: 0 }, global: { dayMicroUsd: 0 } },
    });
  });

  it("GivenTheRealInMemoryLedgerEmpty_WhenSpendIsRead_ThenZeroSpentNotUnknown", async () => {
    const { call } = await setup(new InMemorySpendLedger());
    expect((await call("GET", "/api/projects/ai/spend")).json.spent).toEqual({
      project: { dayMicroUsd: 0, monthMicroUsd: 0 },
      global: { dayMicroUsd: 0, monthMicroUsd: 0 },
    });
  });

  it("GivenALedger_WhenSpendIsRead_ThenTodayAndThisMonthShowForTheProjectAndAll", async () => {
    const { call } = await setup(ledger(120_000, 450_000));
    const { spent } = (await call("GET", "/api/projects/ai/spend")).json;
    expect(spent).toEqual({
      project: { dayMicroUsd: 120_000, monthMicroUsd: 1_200_000 },
      global: { dayMicroUsd: 450_000, monthMicroUsd: 4_500_000 },
    });
  });

  it.each([
    ["no ledger", undefined],
    [
      "a ledger that fails",
      Object.assign(new InMemorySpendLedger(), {
        totals: () => Promise.reject(new Error("down")),
      }),
    ],
  ])("GivenSpend%s_WhenRead_ThenSpentIsNullNotZero", async (_, reader) => {
    const { call } = await setup(reader);
    expect((await call("GET", "/api/projects/ai/spend")).json.spent).toBeNull();
  });

  it("GivenALowerCap_WhenTheOwnerSetsIt_ThenStoredShownAndLoggedWithOldAndNewValues", async () => {
    const { call, tracker } = await setup();
    const res = await call("PUT", "/api/projects/ai/spend-caps", {
      caps: { dailyMicroUsd: 1_000_000 },
      reason: "first trial",
    });
    expect(res.status).toBe(200);
    expect(res.json.effective.project_daily).toBe(1_000_000);
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({ dailyMicroUsd: 1_000_000 });
    const [change] = (await call("GET", "/api/projects/ai/config-changes")).json;
    expect(change).toMatchObject({
      reason: "first trial",
      diff: { spendCaps: { from: {}, to: { dailyMicroUsd: 1_000_000 } } },
    });
  });

  it("GivenTwoCaps_WhenOnlyAThirdIsSet_ThenTheFirstTwoStayAndNullClearsOne", async () => {
    const { call, tracker } = await setup();
    await call("PUT", "/api/projects/ai/spend-caps", {
      caps: { dailyMicroUsd: 1_000_000, monthlyMicroUsd: 10_000_000 },
    });
    await call("PUT", "/api/projects/ai/spend-caps", { caps: { perTaskMicroUsd: 500_000 } });
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({
      dailyMicroUsd: 1_000_000,
      monthlyMicroUsd: 10_000_000,
      perTaskMicroUsd: 500_000,
    });
    const cleared = await call("PUT", "/api/projects/ai/spend-caps", {
      caps: { dailyMicroUsd: null },
    });
    expect(cleared.json.effective.project_daily).toBe(DEFAULT_SPEND_CAPS.dailyMicroUsd);
    expect((await tracker.getProject("ai"))?.spendCaps).toMatchObject({
      dailyMicroUsd: null,
      monthlyMicroUsd: 10_000_000,
    });
  });

  it("GivenACapAboveGlobal_WhenSet_Then422WithTheReasonAndNothingStored", async () => {
    const { call, tracker } = await setup();
    const res = await call("PUT", "/api/projects/ai/spend-caps", {
      caps: { perTaskMicroUsd: 2_000_001 },
    });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("above the global per-task cap $2.00");
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({});
  });

  it.each([
    ["a fraction", { dailyMicroUsd: 1.5 }],
    ["a negative", { dailyMicroUsd: -1 }],
  ])("GivenACapThatIs%s_WhenSet_Then400", async (_, caps) => {
    const { call } = await setup();
    expect((await call("PUT", "/api/projects/ai/spend-caps", { caps })).status).toBe(400);
  });

  it("GivenSomeoneNotOnTheAllowList_WhenSettingCaps_ThenRefusedAndNothingStored", async () => {
    const { call, tracker } = await setup();
    const res = await call("PUT", "/api/projects/ai/spend-caps", { caps: {} }, "eve");
    expect(res.status).toBe(403);
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({});
  });

  // AI-252: the one project-access check covers these routes and tools (projectId in the path,
  // `project` in the input): a project the caller can't read looks absent.
  it("GivenAProjectTheCallerCantRead_WhenSpendIsReadOrSet_ThenNotFoundAndNothingStored", async () => {
    const { call, mcp, tracker } = await setup(undefined, {
      canRead: () => Promise.resolve(false),
    });
    expect((await call("GET", "/api/projects/ai/spend")).status).toBe(404);
    expect(
      (await call("PUT", "/api/projects/ai/spend-caps", { caps: { dailyMicroUsd: 0 } })).status,
    ).toBe(404);
    const tool = await (await mcp())("set_spend_caps", { project: "ai", dailyMicroUsd: 0 });
    expect(tool.isError).toBe(true);
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({});
  });

  it("GivenAnUnknownProject_WhenSpendIsRead_Then404", async () => {
    const { call } = await setup();
    expect((await call("GET", "/api/projects/zz/spend")).status).toBe(404);
  });
});

describe("spend caps MCP tools (AI-249)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("GivenAProject_WhenGetSpendIsCalled_ThenCapsAndSpendShowInDollarsToo", async () => {
    const { mcp } = await setup(ledger(1_230_000, 2_000_000));
    const { isError, data } = await (await mcp())("get_spend", { project: "ai" });
    expect(isError).toBe(false);
    expect(data).toMatchObject({
      project: "AI",
      globalCaps: { source: "default" },
      effectiveUsd: { per_task: "$2.00", project_daily: "$5.00" },
      spentUsd: { projectToday: "$1.23", allProjectsToday: "$2.00" },
    });
  });

  it("GivenACapAboveGlobal_WhenSetSpendCapsIsCalled_ThenAToolErrorWithTheReason", async () => {
    const { mcp, tracker } = await setup();
    const { isError, text } = await (
      await mcp()
    )("set_spend_caps", {
      project: "ai",
      monthlyMicroUsd: 60_000_000,
    });
    expect(isError).toBe(true);
    expect(text).toContain("above the global monthly cap $50.00");
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({});
  });

  it("GivenADailyCap_WhenSetSpendCapsGivesOnlyPerTask_ThenTheDailyCapStays", async () => {
    const { mcp, tracker } = await setup();
    const caller = await mcp();
    await caller("set_spend_caps", { project: "ai", dailyMicroUsd: 1_000_000 });
    await caller("set_spend_caps", { project: "ai", perTaskMicroUsd: 500_000 });
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({
      dailyMicroUsd: 1_000_000,
      perTaskMicroUsd: 500_000,
    });
  });

  it("GivenALowerCap_WhenSetSpendCapsIsCalled_ThenStoredAndUnknownSpendSaysSo", async () => {
    const { mcp, tracker } = await setup();
    const { isError, data } = await (
      await mcp()
    )("set_spend_caps", {
      project: "ai",
      dailyMicroUsd: 0,
      reason: "no paid spend yet",
    });
    expect(isError).toBe(false);
    expect(data).toMatchObject({ projectCaps: { dailyMicroUsd: 0 }, spent: "unknown" });
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({ dailyMicroUsd: 0 });
  });
});
