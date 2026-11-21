import { describe, expect, it } from "vitest";
import { DEFAULT_SPEND_CAPS, type SpendCaps } from "../entities/spend-caps";
import type { SpendCapsStore } from "../ports/spend-caps";

/** `make` must return an empty store whose clock is `now`. */
export function spendCapsStoreContract(
  name: string,
  make: (now: () => Date) => Promise<SpendCapsStore>,
): void {
  describe(`SpendCapsStore contract: ${name}`, () => {
    let clock = new Date("2026-11-21T10:00:00.000Z");
    const fresh = () => {
      clock = new Date("2026-11-21T10:00:00.000Z");
      return make(() => clock);
    };
    const caps = (dailyMicroUsd: number): SpendCaps => ({ ...DEFAULT_SPEND_CAPS, dailyMicroUsd });
    const isConflict = (err: unknown) => (err as { code?: string }).code === "conflict";

    it("GivenNothingStored_WhenRead_ThenNull", async () => {
      expect(await (await fresh()).getGlobal()).toBeNull();
    });

    it("GivenNothingStored_WhenPutWithNull_ThenStoredAndStamped", async () => {
      const store = await fresh();
      const saved = await store.putGlobal(caps(1_000_000), null);
      expect(saved).toEqual({ ...caps(1_000_000), updatedAt: clock.toISOString() });
      expect(await store.getGlobal()).toEqual(saved);
    });

    it("GivenStoredCaps_WhenPutWithTheStampRead_ThenReplacedWithALaterStamp", async () => {
      const store = await fresh();
      const first = await store.putGlobal(caps(1_000_000), null);
      // Same clock: the stamp still moves on, so a stale read can't match it.
      const second = await store.putGlobal(caps(2_000_000), first.updatedAt);
      expect(second.dailyMicroUsd).toBe(2_000_000);
      expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
      expect(await store.getGlobal()).toEqual(second);
    });

    it("GivenStoredCaps_WhenPutWithAStaleOrNullStamp_ThenConflictAndNothingWritten", async () => {
      const store = await fresh();
      const first = await store.putGlobal(caps(1_000_000), null);
      clock = new Date(clock.getTime() + 60_000);
      const second = await store.putGlobal(caps(2_000_000), first.updatedAt);
      for (const stale of [first.updatedAt, null, "2026-11-21T09:00:00.000Z"]) {
        await expect(store.putGlobal(caps(3_000_000), stale)).rejects.toSatisfy(isConflict);
      }
      expect(await store.getGlobal()).toEqual(second);
    });

    it("GivenNothingStored_WhenPutWithAStamp_ThenConflict", async () => {
      const store = await fresh();
      await expect(store.putGlobal(caps(1_000_000), "2026-11-21T10:00:00.000Z")).rejects.toSatisfy(
        isConflict,
      );
      expect(await store.getGlobal()).toBeNull();
    });

    it("GivenAFractionOrNegative_WhenPut_ThenRejectedAndNothingWritten", async () => {
      const store = await fresh();
      await expect(store.putGlobal(caps(1.5), null)).rejects.toThrow();
      await expect(store.putGlobal(caps(-1), null)).rejects.toThrow();
      expect(await store.getGlobal()).toBeNull();
    });
  });
}
