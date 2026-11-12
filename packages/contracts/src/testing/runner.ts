import { describe, expect, it } from "vitest";
import { Runner, type RunTokenGrant } from "../entities/runner";
import type { RunnerStore } from "../ports/runner";

export interface RunnerStoreContractOptions {
  /** Per-test timeout for the concurrent cases: emulator transactions retry under contention. */
  raceTimeoutMs?: number;
}

/** `make` must return a store with nothing in it, reading time from `now` (token expiry). */
export function runnerStoreContract(
  name: string,
  make: (now: () => Date) => Promise<RunnerStore>,
  options: RunnerStoreContractOptions = {},
): void {
  const itRaces = (title: string, fn: () => Promise<void>) => it(title, fn, options.raceTimeoutMs);

  describe(`RunnerStore contract: ${name}`, () => {
    const start = new Date("2026-11-11T12:00:00.000Z");
    const at = (seconds: number) => new Date(start.getTime() + seconds * 1000).toISOString();
    const runner = (overrides: Partial<Runner> = {}): Runner =>
      Runner.parse({
        id: crypto.randomUUID(),
        name: "Andy's Mac",
        projectIds: ["ai"],
        createdAt: start.toISOString(),
        createdBy: "andy",
        expiresAt: "2027-02-09T12:00:00.000Z",
        ...overrides,
      });
    const hash = () => crypto.randomUUID();

    it("GivenAStoredRunner_WhenReadByIdOrSecretHash_ThenItComesBackWithoutTheHash", async () => {
      const store = await make(() => start);
      const r = runner();
      const h = hash();
      expect(await store.create({ runner: r, secretHash: h }, 2, start)).toEqual(r);

      expect(await store.get(r.id)).toEqual(r);
      expect(await store.findBySecretHash(h)).toEqual(r);
      expect(await store.findBySecretHash(hash())).toBeNull();
      expect(JSON.stringify(await store.list())).not.toContain(h);
    });

    it("GivenTwoActiveRunners_WhenAThirdIsCreated_ThenConflict", async () => {
      const store = await make(() => start);
      await store.create({ runner: runner(), secretHash: hash() }, 2, start);
      await store.create({ runner: runner(), secretHash: hash() }, 2, start);

      await expect(
        store.create({ runner: runner(), secretHash: hash() }, 2, start),
      ).rejects.toMatchObject({ name: "WorkTrackerError", code: "conflict" });
    });

    it("GivenARevokedAndAnExpiredRunner_WhenCreating_ThenTheyDontCountTowardTheCap", async () => {
      const store = await make(() => start);
      const old = runner();
      await store.create({ runner: old, secretHash: hash() }, 2, start);
      await store.revoke(old.id, at(1));
      await store.create(
        { runner: runner({ expiresAt: at(-1) }), secretHash: hash() },
        2,
        new Date(at(0)),
      );

      await store.create({ runner: runner(), secretHash: hash() }, 2, start);
      await store.create({ runner: runner(), secretHash: hash() }, 2, start);
      expect(await store.list()).toHaveLength(4);
    });

    itRaces("GivenConcurrentCreates_WhenRacingForTheLastSlot_ThenOnlyOneWins", async () => {
      const store = await make(() => start);
      await store.create({ runner: runner(), secretHash: hash() }, 2, start);
      const results = await Promise.allSettled([
        store.create({ runner: runner(), secretHash: hash() }, 2, start),
        store.create({ runner: runner(), secretHash: hash() }, 2, start),
        store.create({ runner: runner(), secretHash: hash() }, 2, start),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    it("GivenRunners_WhenListed_ThenNewestFirstIncludingRevoked", async () => {
      const store = await make(() => start);
      const a = runner({ createdAt: at(0) });
      const b = runner({ createdAt: at(5) });
      await store.create({ runner: a, secretHash: hash() }, 5, start);
      await store.create({ runner: b, secretHash: hash() }, 5, start);
      await store.revoke(a.id, at(6));

      expect((await store.list()).map((r) => r.id)).toEqual([b.id, a.id]);
    });

    it("GivenARunner_WhenRevokedTwice_ThenTheFirstTimeStays", async () => {
      const store = await make(() => start);
      const r = runner();
      await store.create({ runner: r, secretHash: hash() }, 2, start);

      expect((await store.revoke(r.id, at(1))).revokedAt).toBe(at(1));
      expect((await store.revoke(r.id, at(2))).revokedAt).toBe(at(1));
      await expect(store.revoke("missing", at(3))).rejects.toMatchObject({ code: "not_found" });
    });

    it("GivenAClaim_WhenAnotherComesWithinTheInterval_ThenTooSoonAndLastSeenStays", async () => {
      const store = await make(() => start);
      const r = runner();
      await store.create({ runner: r, secretHash: hash() }, 2, start);

      expect(await store.recordClaim(r.id, at(0), 10_000)).toBe("ok");
      expect(await store.recordClaim(r.id, at(9), 10_000)).toBe("too_soon");
      expect((await store.get(r.id))?.lastSeenAt).toBe(at(0));
      expect(await store.recordClaim(r.id, at(10), 10_000)).toBe("ok");
      expect((await store.get(r.id))?.lastSeenAt).toBe(at(10));
      await expect(store.recordClaim("missing", at(0), 1)).rejects.toMatchObject({
        code: "not_found",
      });
    });

    itRaces("GivenConcurrentClaims_WhenRacing_ThenOnlyOneIsAccepted", async () => {
      const store = await make(() => start);
      const r = runner();
      await store.create({ runner: r, secretHash: hash() }, 2, start);
      const results = await Promise.all([
        store.recordClaim(r.id, at(0), 10_000),
        store.recordClaim(r.id, at(0), 10_000),
        store.recordClaim(r.id, at(0), 10_000),
      ]);
      expect(results.filter((x) => x === "ok")).toHaveLength(1);
    });

    it("GivenARunToken_WhenReadBeforeAndAfterItsExpiry_ThenGrantThenNull", async () => {
      let now = start;
      const store = await make(() => now);
      const h = hash();
      const grant: RunTokenGrant = { runId: "run-1", runnerId: "runner-1", expiresAt: at(60) };
      await store.putRunToken(h, grant);

      expect(await store.getRunToken(h)).toEqual(grant);
      expect(await store.getRunToken(hash())).toBeNull();
      now = new Date(at(60));
      expect(await store.getRunToken(h)).toBeNull();
    });
  });
}
