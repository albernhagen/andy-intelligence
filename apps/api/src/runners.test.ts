import { InMemoryRunnerStore, type MintedRunner, type RunnerView } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import { RUNNER_CLAIM_PATH, RUNNER_LOOKUPS_PER_MINUTE } from "./runners";

/**
 * AI-79 (ADR-0089 slice 3): runner registration end to end in-process. Andy mints a runner in
 * the UI's API, the runner claims with its secret, and a revoke shuts it out.
 */

async function setup() {
  let now = new Date("2026-11-11T12:00:00.000Z");
  const store = new InMemoryRunnerStore(() => now);
  const t = githubApp({ now: () => now }, { runners: store });
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  await t.call("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "AI", key: "AI", repos: [REPO] }),
  });
  const mint = async (name = "Andy's Mac") => {
    const res = await t.call("/api/runners", {
      method: "POST",
      body: JSON.stringify({ name, projectIds: ["ai"] }),
    });
    return { status: res.status, body: (await res.json()) as MintedRunner };
  };
  const claim = (secret: string | null, body: unknown = {}) =>
    t.call(RUNNER_CLAIM_PATH, { method: "POST", body: JSON.stringify(body) }, secret);
  const list = async () => (await (await t.call("/api/runners")).json()) as RunnerView[];
  return {
    t,
    store,
    mint,
    claim,
    list,
    advance: (s: number) => (now = new Date(now.getTime() + s * 1000)),
  };
}

describe("runner registration and claim", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAMintedSecret_WhenTheRunnerClaims_ThenRunNullAndTheRunnerShowsPresent", async () => {
    const s = await setup();
    const { status, body } = await s.mint();
    expect(status).toBe(201);
    expect(body.secret).toMatch(/^air_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(await s.list())).not.toContain(body.secret);

    const res = await s.claim(body.secret, { version: "0.1.0" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run: null, pollSeconds: 30, heartbeatSeconds: 60 });
    expect(await s.list()).toMatchObject([{ id: body.runner.id, present: true, state: "active" }]);
  });

  it("GivenAClaim_WhenTheRunnerClaimsAgainWithin10Seconds_Then429", async () => {
    const s = await setup();
    const { body } = await s.mint();
    await s.claim(body.secret);

    s.advance(5);
    const again = await s.claim(body.secret);
    expect(again.status).toBe(429);
    expect(again.headers.get("retry-after")).toBe("10");

    s.advance(5);
    expect((await s.claim(body.secret)).status).toBe(200);
  });

  it("GivenARevokedRunner_WhenItClaimsWithTheSameSecret_Then401", async () => {
    const s = await setup();
    const { body } = await s.mint();
    expect((await s.claim(body.secret)).status).toBe(200);

    const revoked = await s.t.call(`/api/runners/${body.runner.id}/revoke`, { method: "POST" });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ state: "revoked", present: false });

    s.advance(10);
    expect((await s.claim(body.secret)).status).toBe(401);
  });

  it.each([
    ["no token", null],
    ["a malformed token", "not-a-secret"],
    ["an unknown secret", `air_${"A".repeat(43)}`],
    ["Andy's Firebase token", "andy"],
  ])("GivenAClaimWith%s_WhenPosted_Then401", async (_what, secret) => {
    const s = await setup();
    expect((await s.claim(secret)).status).toBe(401);
  });

  it("GivenManyClaimsWithGuessedSecrets_WhenTheLookupCapIsReached_Then429BeforeAnyLookup", async () => {
    const s = await setup();
    const find = vi.spyOn(s.store, "findBySecretHash");
    for (let i = 0; i < RUNNER_LOOKUPS_PER_MINUTE; i++) {
      expect((await s.claim(`air_${String(i).padStart(43, "x")}`)).status).toBe(401);
    }

    expect((await s.claim(`air_${"y".repeat(43)}`)).status).toBe(429);
    expect(find).toHaveBeenCalledTimes(RUNNER_LOOKUPS_PER_MINUTE);
  });

  it("GivenTwoRunners_WhenAThirdIsMinted_Then409", async () => {
    const s = await setup();
    await s.mint("A");
    await s.mint("B");
    const third = await s.mint("C");
    expect(third.status).toBe(409);
  });

  it("GivenNoSignIn_WhenListingOrMinting_Then401", async () => {
    const s = await setup();
    expect((await s.t.call("/api/runners", {}, null)).status).toBe(401);
    expect(
      (
        await s.t.call(
          "/api/runners",
          { method: "POST", body: JSON.stringify({ name: "x", projectIds: ["ai"] }) },
          null,
        )
      ).status,
    ).toBe(401);
  });
});
