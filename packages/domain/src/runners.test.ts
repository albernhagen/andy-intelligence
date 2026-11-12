import { InMemoryRunnerStore, InMemoryWorkTracker } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunnerService, isPresent } from "./runners";

const START = new Date("2026-11-11T12:00:00.000Z");

async function setup() {
  let now = START;
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ name: "AI", key: "AI" });
  const store = new InMemoryRunnerStore(() => now);
  let n = 0;
  const credentials = { newSecret: () => `secret-${++n}`, hash: (s: string) => `hash(${s})` };
  const service = new RunnerService(store, tracker, credentials, () => now);
  return { service, store, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe("RunnerService", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAndy_WhenHeMintsARunner_ThenTheSecretIsReturnedOnceAndOnlyItsHashIsStored", async () => {
    const { service, store } = await setup();

    const minted = await service.mint({ name: "Mac", projectIds: ["ai"] }, "user:uid-1");

    expect(minted.secret).toBe("secret-1");
    expect(minted.runner).toMatchObject({
      name: "Mac",
      projectIds: ["ai"],
      runsAtOnce: 1,
      createdBy: "user:uid-1",
      expiresAt: "2027-02-09T12:00:00.000Z",
      present: false,
      state: "active",
    });
    expect(await store.findBySecretHash("hash(secret-1)")).toMatchObject({ id: minted.runner.id });
    expect(JSON.stringify(await service.list())).not.toContain("secret-1");
  });

  it("GivenAnAgent_WhenItMintsOrRevokes_ThenForbidden", async () => {
    const { service } = await setup();
    await expect(service.mint({ name: "Mac", projectIds: ["ai"] }, "agent:r1")).rejects.toThrow(
      "only the owner can register a local runner",
    );
    const { runner } = await service.mint({ name: "Mac", projectIds: ["ai"] }, "andy");
    await expect(service.revoke(runner.id, "system")).rejects.toThrow(
      "only the owner can revoke a local runner",
    );
  });

  it("GivenAnUnknownProject_WhenMinting_ThenNotFoundAndNothingStored", async () => {
    const { service } = await setup();
    await expect(service.mint({ name: "Mac", projectIds: ["nope"] }, "andy")).rejects.toThrow(
      "project not found: nope",
    );
    expect(await service.list()).toEqual([]);
  });

  it("GivenTwoRunners_WhenAThirdIsMinted_ThenRefusedUntilOneIsRevoked", async () => {
    const { service } = await setup();
    const first = await service.mint({ name: "A", projectIds: ["ai"] }, "andy");
    await service.mint({ name: "B", projectIds: ["ai"] }, "andy");

    await expect(service.mint({ name: "C", projectIds: ["ai"] }, "andy")).rejects.toMatchObject({
      code: "runner_limit",
    });
    await service.revoke(first.runner.id, "andy");
    await expect(service.mint({ name: "C", projectIds: ["ai"] }, "andy")).resolves.toBeTruthy();
  });

  it("GivenAMintedSecret_WhenItAuthenticatesBeforeAndAfterRevoke_ThenRunnerThenNull", async () => {
    const { service } = await setup();
    const { runner, secret } = await service.mint({ name: "Mac", projectIds: ["ai"] }, "andy");

    expect((await service.authenticate(secret))?.id).toBe(runner.id);
    expect(await service.authenticate("wrong")).toBeNull();
    await service.revoke(runner.id, "andy");
    expect(await service.authenticate(secret)).toBeNull();
    expect((await service.list())[0]?.state).toBe("revoked");
  });

  it("GivenARunnerPast90Days_WhenItAuthenticates_ThenNullAndItReadsExpired", async () => {
    const { service, advance } = await setup();
    const { secret } = await service.mint({ name: "Mac", projectIds: ["ai"] }, "andy");

    advance(90 * 24 * 60 * 60 * 1000);

    expect(await service.authenticate(secret)).toBeNull();
    expect((await service.list())[0]?.state).toBe("expired");
  });

  it("GivenAClaim_WhenTheNextComesWithin10Seconds_ThenTooSoon_AndPresenceLasts2Minutes", async () => {
    const { service, advance } = await setup();
    const { secret } = await service.mint({ name: "Mac", projectIds: ["ai"] }, "andy");
    const runner = (await service.authenticate(secret))!;

    expect(await service.recordClaim(runner)).toBe("ok");
    expect(await service.presentFor("ai")).toBe(true);
    expect(await service.presentFor("ops")).toBe(false);
    advance(9_000);
    expect(await service.recordClaim(runner)).toBe("too_soon");
    advance(111_000);
    expect(await service.presentFor("ai")).toBe(false);
    expect((await service.list())[0]?.present).toBe(false);
  });

  it("GivenARevokedRunnerSeenJustNow_WhenPresenceIsChecked_ThenNotPresent", () => {
    const runner = {
      id: "r1",
      name: "Mac",
      projectIds: ["ai"],
      runsAtOnce: 1,
      createdAt: START.toISOString(),
      createdBy: "andy",
      expiresAt: "2027-02-09T12:00:00.000Z",
      revokedAt: START.toISOString(),
      lastSeenAt: START.toISOString(),
    };
    expect(isPresent(runner, START)).toBe(false);
    expect(isPresent({ ...runner, revokedAt: null }, START)).toBe(true);
  });
});
