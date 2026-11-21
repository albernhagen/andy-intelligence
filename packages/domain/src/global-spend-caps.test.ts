import {
  DEFAULT_SPEND_CAPS,
  GLOBAL_ENTITY_ID,
  InMemoryConfigChangeStore,
  InMemorySpendCapsStore,
  InMemorySpendLedger,
  InMemoryWorkTracker,
  type SpendCapsStore,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSpendCaps, SPEND_CAPS_ENTITY } from "./global-spend-caps";
import { ProjectService } from "./projects";
import { SpendGate } from "./spend-gate";

const OWNER = "user:uid-1" as const;
const AGENT = "agent:run-1" as const;

/** A store whose reads fail, as an unreachable database would. */
const unreadable: SpendCapsStore = {
  getGlobal: () => Promise.reject(new Error("firestore unavailable")),
  putGlobal: () => Promise.reject(new Error("firestore unavailable")),
};

describe("GlobalSpendCaps (AI-276)", () => {
  let store: InMemorySpendCapsStore;
  let changes: InMemoryConfigChangeStore;
  let caps: GlobalSpendCaps;
  let minute: number;
  let ids: number;
  const now = () => new Date(Date.parse("2026-11-21T10:00:00.000Z") + minute++ * 60_000);

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    minute = 0;
    ids = 0;
    store = new InMemorySpendCapsStore(now);
    changes = new InMemoryConfigChangeStore();
    caps = new GlobalSpendCaps(store, changes, now, () => `change-${++ids}`);
  });

  it("GivenNothingStored_WhenRead_ThenTheCodeDefaults", async () => {
    expect(await caps.read()).toEqual({
      caps: DEFAULT_SPEND_CAPS,
      source: "default",
      updatedAt: null,
    });
  });

  it("GivenNoStoreConfigured_WhenRead_ThenTheDefaultsAndSavingIsRefused", async () => {
    const none = new GlobalSpendCaps(null, changes, now);
    expect((await none.read()).source).toBe("default");
    await expect(none.put(DEFAULT_SPEND_CAPS, null, OWNER)).rejects.toMatchObject({
      message: expect.stringContaining("isn't configured"),
    });
  });

  it("GivenAnUnreadableStore_WhenRead_ThenItThrowsInsteadOfFallingBackToDefaults", async () => {
    await expect(new GlobalSpendCaps(unreadable, changes, now).caps()).rejects.toThrow(
      "firestore unavailable",
    );
  });

  // Acceptance: if the stored global caps can't be read, no paid call starts.
  it("GivenAnUnreadableStore_WhenAPaidTaskWouldStart_ThenTheGateRefusesAndReservesNothing", async () => {
    const failing = new GlobalSpendCaps(unreadable, changes, now);
    const ledger = new InMemorySpendLedger();
    const gate = new SpendGate(
      ledger,
      async () => ({ priceInPerMTokUsd: 1, priceOutPerMTokUsd: 2 }),
      async () => ({ global: await failing.caps(), project: null }),
      now,
    );
    await expect(
      gate.reserve({
        id: "run-1",
        projectId: "ai",
        route: { harness: "opencode", provider: "openrouter", model: "vendor/model-x" },
      }),
    ).rejects.toMatchObject({
      code: "spend_cap",
      message: expect.stringContaining("can't be read"),
    });
    expect((await ledger.totals({}, now().toISOString())).dayMicroUsd).toBe(0);
  });

  it("GivenAnUnreadableStore_WhenTheOwnerSetsAProjectCap_ThenItIsNotSaved", async () => {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "AI", key: "AI" });
    const failing = new GlobalSpendCaps(unreadable, changes, now);
    const projects = new ProjectService(tracker, null, null, now, null, undefined, () =>
      failing.caps(),
    );
    await expect(
      projects.update("ai", { spendCaps: { dailyMicroUsd: 0 } }, { actor: OWNER, email: "" }),
    ).rejects.toThrow("firestore unavailable");
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({});
  });

  it("GivenTheDefaults_WhenTheOwnerSavesCaps_ThenStoredAndLoggedWithWhoWhenAndOldAndNewValues", async () => {
    const saved = await caps.put(
      { ...DEFAULT_SPEND_CAPS, dailyMicroUsd: 1_000_000 },
      null,
      OWNER,
      "first paid trial",
    );
    expect(saved).toMatchObject({ source: "stored", caps: { dailyMicroUsd: 1_000_000 } });
    expect(await caps.read()).toEqual(saved);
    const [change] = await caps.changeLog(OWNER);
    expect(change).toMatchObject({
      entity: SPEND_CAPS_ENTITY,
      entityId: GLOBAL_ENTITY_ID,
      projectId: null,
      // Recorded as the owner, the same way project settings changes are (changeActor, AI-19).
      actor: "andy",
      reason: "first paid trial",
      status: "applied",
      diff: { dailyMicroUsd: { from: 5_000_000, to: 1_000_000 } },
    });
    expect(change?.createdAt).toBe("2026-11-21T10:01:00.000Z");
  });

  it("GivenAStaleRead_WhenSaving_ThenConflictAndNothingChanges", async () => {
    const first = await caps.put({ ...DEFAULT_SPEND_CAPS, dailyMicroUsd: 1_000_000 }, null, OWNER);
    await caps.put({ ...DEFAULT_SPEND_CAPS, dailyMicroUsd: 2_000_000 }, first.updatedAt, OWNER);
    await expect(
      caps.put({ ...DEFAULT_SPEND_CAPS, dailyMicroUsd: 3_000_000 }, first.updatedAt, OWNER),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await caps.caps()).dailyMicroUsd).toBe(2_000_000);
    expect(await caps.changeLog(OWNER)).toHaveLength(2);
  });

  it("GivenANonOwner_WhenSavingOrReadingTheLog_ThenForbiddenAndNothingStored", async () => {
    await expect(caps.put(DEFAULT_SPEND_CAPS, null, AGENT)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(caps.changeLog(AGENT)).rejects.toMatchObject({ code: "forbidden" });
    expect(await store.getGlobal()).toBeNull();
  });

  it("GivenNothingChanged_WhenSaved_ThenStoredButNoChangeLogged", async () => {
    await caps.put(DEFAULT_SPEND_CAPS, null, OWNER);
    expect((await caps.read()).source).toBe("stored");
    expect(await caps.changeLog(OWNER)).toEqual([]);
  });

  it("GivenASave_WhenReverted_ThenTheOldCapsAreBackAndTheRevertIsLogged", async () => {
    await caps.put({ ...DEFAULT_SPEND_CAPS, perTaskMicroUsd: 500_000 }, null, OWNER);
    const { global, reverted } = await caps.revert("change-1", OWNER);
    expect(global.caps).toEqual(DEFAULT_SPEND_CAPS);
    expect(reverted).toMatchObject({ id: "change-1", status: "reverted" });
    const [latest] = await caps.changeLog(OWNER);
    expect(latest).toMatchObject({
      reason: "Revert of change-1",
      diff: { perTaskMicroUsd: { from: 500_000, to: 2_000_000 } },
    });
  });

  it("GivenANewerChangeOfTheSameCap_WhenTheOlderIsReverted_ThenRefusedNamingTheNewer", async () => {
    const first = await caps.put({ ...DEFAULT_SPEND_CAPS, dailyMicroUsd: 1_000_000 }, null, OWNER);
    await caps.put({ ...DEFAULT_SPEND_CAPS, dailyMicroUsd: 2_000_000 }, first.updatedAt, OWNER);
    await expect(caps.revert("change-1", OWNER)).rejects.toMatchObject({
      code: "not_revertible",
      message: expect.stringContaining("change-2"),
    });
  });

  it("GivenARevertedChange_WhenRevertedAgain_ThenRefused", async () => {
    await caps.put({ ...DEFAULT_SPEND_CAPS, dailyMicroUsd: 1_000_000 }, null, OWNER);
    await caps.revert("change-1", OWNER);
    await expect(caps.revert("change-1", OWNER)).rejects.toMatchObject({
      code: "not_revertible",
    });
  });

  it("GivenAnotherEntitysChange_WhenRevertedHere_ThenNotFound", async () => {
    await expect(caps.revert("nope", OWNER)).rejects.toMatchObject({ code: "not_found" });
  });
});
