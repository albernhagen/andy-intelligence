import { InMemoryConfigChangeStore, InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";

/** M4.12: flip a setting, list the log, revert from the settings route; the revert is logged. */

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "uid-1", email: "andy@example.com", emailVerified: true };
  },
};

async function setup(options: { store?: boolean } = {}) {
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ name: "AI", key: "AI" });
  const app = createApp({
    verifier,
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    ...(options.store === false ? {} : { configChanges: new InMemoryConfigChangeStore() }),
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  return { call, tracker };
}

describe("config change log routes (M4.12)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-12T10:00:00.000Z") });
  });
  afterEach(() => vi.useRealTimers());

  /** The next write a second later, so the log's newest-first order is the write order. */
  const later = () => vi.setSystemTime(Date.now() + 1000);

  it("GivenAFlip_WhenRevertedFromTheSettingsRoute_ThenTheSettingIsBackAndTheRevertIsLogged", async () => {
    const { call, tracker } = await setup();
    await call("PATCH", "/api/projects/ai", { autoRefine: false });
    const [flip] = (await call("GET", "/api/projects/ai/config-changes")).json;

    later();
    const reverted = await call("POST", `/api/projects/ai/config-changes/${flip.id}/revert`);
    const log = (await call("GET", "/api/projects/ai/config-changes")).json;

    expect(reverted.status).toBe(200);
    expect(reverted.json.reverted).toMatchObject({ id: flip.id, status: "reverted" });
    expect((await tracker.getProject("ai"))?.autoRefine).toBe(true);
    expect(log).toMatchObject([
      {
        reason: `Revert of ${flip.id}`,
        actor: "andy",
        diff: { autoRefine: { from: false, to: true } },
      },
      { id: flip.id, status: "reverted", decidedBy: "user:uid-1" },
    ]);
  });

  it("GivenTheSettingChangedAgain_WhenReverted_Then409NamingTheNewerChange", async () => {
    const { call } = await setup();
    await call("PATCH", "/api/projects/ai", { runsAtOnce: 3 });
    later();
    await call("PATCH", "/api/projects/ai", { runsAtOnce: 4 });
    const [newer, flip] = (await call("GET", "/api/projects/ai/config-changes")).json;

    const refused = await call("POST", `/api/projects/ai/config-changes/${flip.id}/revert`);

    expect(refused.status).toBe(409);
    expect(refused.json.error).toContain(newer.id);
  });

  it("GivenUnknownIdsOrALimit_WhenCalled_Then404sAndTheLimitHolds", async () => {
    const { call } = await setup();
    await call("PATCH", "/api/projects/ai", { paused: true });
    await call("PATCH", "/api/projects/ai", { paused: false });

    expect((await call("GET", "/api/projects/ai/config-changes?limit=1")).json).toHaveLength(1);
    expect((await call("GET", "/api/projects/none/config-changes")).status).toBe(404);
    expect((await call("POST", "/api/projects/ai/config-changes/missing/revert")).status).toBe(404);
    expect((await call("GET", "/api/projects/ai/config-changes?limit=500")).status).toBe(400);
  });

  it("GivenNoStore_WhenListed_ThenTheRouteIsNotThere", async () => {
    const { call } = await setup({ store: false });
    expect((await call("GET", "/api/projects/ai/config-changes")).status).toBe(404);
  });
});
