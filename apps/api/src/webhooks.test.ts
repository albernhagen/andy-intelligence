import { InMemoryCodeEventLog, InMemoryCodeHost, InMemoryWorkTracker } from "@andy/contracts";
import { sign } from "@octokit/webhooks-methods";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { MAX_WEBHOOK_BYTES, REPO_INDEX_TTL_MS, WEBHOOK_PATH, WEBHOOK_RATE_LIMIT } from "./webhooks";

const SECRET = "test-webhook-secret";
const REPO = "albernhagen/andy-intelligence";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

const prPayload = (repo = REPO) => ({
  action: "opened",
  repository: { full_name: repo },
  pull_request: {
    number: 31,
    state: "open",
    merged: false,
    draft: false,
    title: "M1.5: GitHub App",
    head: { ref: "m1.5/github-app", sha: "abc123" },
    base: { ref: "main" },
    html_url: `https://github.com/${repo}/pull/31`,
  },
});

describe("GitHub webhook receiver", () => {
  let clock: Date;
  let tracker: InMemoryWorkTracker;
  let events: InMemoryCodeEventLog;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    clock = new Date("2026-11-02T12:00:00.000Z");
    tracker = new InMemoryWorkTracker();
    events = new InMemoryCodeEventLog();
    await tracker.createProject({ name: "andy-intelligence", key: "AI", repos: [REPO] });
    app = createApp({
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      github: {
        webhookSecret: SECRET,
        codeHost: new InMemoryCodeHost([
          {
            fullName: REPO,
            defaultBranch: "main",
            private: false,
            url: `https://github.com/${REPO}`,
          },
        ]),
        events,
        now: () => clock,
      },
    });
  });

  async function deliver(
    opts: {
      event?: string;
      id?: string | null;
      body?: string;
      payload?: unknown;
      secret?: string;
    } = {},
  ) {
    const body = opts.body ?? JSON.stringify(opts.payload ?? prPayload());
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-github-event": opts.event ?? "pull_request",
      "x-hub-signature-256": await sign(opts.secret ?? SECRET, body),
    };
    const id = opts.id === undefined ? "72d3162e-cc78-11e3-81ab-4c9367dc0958" : opts.id;
    if (id !== null) headers["x-github-delivery"] = id;
    return app.request(WEBHOOK_PATH, { method: "POST", headers, body });
  }

  it("GivenASignedPullRequestEventOnARegisteredRepo_WhenDelivered_ThenItIsRecorded", async () => {
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "recorded" });
    expect(await events.get("72d3162e-cc78-11e3-81ab-4c9367dc0958")).toMatchObject({
      kind: "pull_request",
      projectId: "ai",
      repo: REPO,
      action: "opened",
      receivedAt: "2026-11-02T12:00:00.000Z",
      pullRequest: { number: 31, state: "open" },
    });
  });

  it("GivenARecordedDelivery_WhenReplayed_ThenItIsANoOp", async () => {
    await deliver();
    const first = await events.get("72d3162e-cc78-11e3-81ab-4c9367dc0958");
    clock = new Date("2026-11-02T12:05:00.000Z");
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "duplicate" });
    expect(await events.get("72d3162e-cc78-11e3-81ab-4c9367dc0958")).toEqual(first);
  });

  it("GivenAWrongSignature_WhenDelivered_Then401AndNothingIsStored", async () => {
    const res = await deliver({ secret: "attacker" });
    expect(res.status).toBe(401);
    expect(await events.get("72d3162e-cc78-11e3-81ab-4c9367dc0958")).toBeNull();
  });

  it("GivenNoSignature_WhenDelivered_Then401", async () => {
    const res = await app.request(WEBHOOK_PATH, {
      method: "POST",
      headers: { "x-github-event": "pull_request", "x-github-delivery": "abc" },
      body: JSON.stringify(prPayload()),
    });
    expect(res.status).toBe(401);
  });

  it("GivenAnUnregisteredRepo_WhenDelivered_Then202AndNothingIsStored", async () => {
    const res = await deliver({ payload: prPayload("someone/else") });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ result: "ignored", reason: "repo" });
    expect(await events.get("72d3162e-cc78-11e3-81ab-4c9367dc0958")).toBeNull();
  });

  it("GivenAPing_WhenDelivered_ThenPong", async () => {
    const res = await deliver({ event: "ping", payload: { zen: "hi" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "pong" });
  });

  it("GivenAnEventWeDontRecord_WhenDelivered_Then202Ignored", async () => {
    const res = await deliver({ event: "push" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ result: "ignored", reason: "event" });
  });

  it("GivenAMissingOrUnsafeDeliveryId_WhenDelivered_Then400", async () => {
    expect((await deliver({ id: null })).status).toBe(400);
    expect((await deliver({ id: "../../projects/ai" })).status).toBe(400);
  });

  it("GivenASignedBodyThatIsNotJson_WhenDelivered_Then400", async () => {
    expect((await deliver({ body: "not json" })).status).toBe(400);
  });

  it("GivenASignedPayloadOfTheWrongShape_WhenDelivered_Then400", async () => {
    const res = await deliver({ event: "check_run" });
    expect(res.status).toBe(400);
  });

  it("GivenAnOversizedBody_WhenDelivered_Then413", async () => {
    const res = await deliver({ body: "x".repeat(MAX_WEBHOOK_BYTES + 1) });
    expect(res.status).toBe(413);
  });

  it("GivenAnUnsignedFlood_WhenGitHubDelivers_ThenTheRealDeliveryIsStillRecorded", async () => {
    for (let i = 0; i < WEBHOOK_RATE_LIMIT + 10; i++) {
      expect((await deliver({ event: "ping", secret: "attacker" })).status).toBe(401);
    }
    expect(await (await deliver()).json()).toEqual({ result: "recorded" });
  });

  it("GivenASignedFlood_WhenOverTheRateCap_Then429UntilTheWindowEnds", async () => {
    for (let i = 0; i < WEBHOOK_RATE_LIMIT; i++) await deliver({ event: "ping" });
    expect((await deliver({ event: "ping" })).status).toBe(429);
    clock = new Date(clock.getTime() + 60_000);
    expect((await deliver({ event: "ping" })).status).toBe(200);
  });

  it("GivenARepoRegisteredAfterAnEvent_WhenDelivered_ThenItCountsOnceTheCacheExpires", async () => {
    await deliver({ payload: prPayload("albernhagen/later"), id: "a1" });
    await tracker.createProject({ name: "later", key: "LATER", repos: ["albernhagen/later"] });
    const cached = await deliver({ payload: prPayload("albernhagen/later"), id: "a2" });
    expect(await cached.json()).toEqual({ result: "ignored", reason: "repo" });
    clock = new Date(clock.getTime() + REPO_INDEX_TTL_MS);
    const fresh = await deliver({ payload: prPayload("albernhagen/later"), id: "a3" });
    expect(await fresh.json()).toEqual({ result: "recorded" });
  });

  it("GivenNoGitHubConfig_WhenDelivered_ThenTheRouteDoesNotExist", async () => {
    const off = createApp({
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
    });
    const res = await off.request(WEBHOOK_PATH, { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });

  describe("project registration", () => {
    const create = (repos: string[], key = "NEW") =>
      app.request("/api/projects", {
        method: "POST",
        headers: { authorization: "Bearer andy", "content-type": "application/json" },
        body: JSON.stringify({ name: "New", key, repos }),
      });

    it("GivenARepoWithoutTheApp_WhenAProjectIsCreated_Then422", async () => {
      const res = await create(["albernhagen/not-installed"]);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toMatch(/GitHub App/);
    });

    it("GivenARepoOfAnotherProject_WhenAProjectIsCreated_Then409", async () => {
      expect((await create([REPO.toUpperCase()])).status).toBe(409);
    });
  });
});
