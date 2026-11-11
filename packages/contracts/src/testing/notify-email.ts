import { describe, expect, it } from "vitest";
import type { EmailNotifyState } from "../entities/notify-email";
import type { NotifyFlushQueue, NotifyLedger } from "../ports/notify-email";

const state = (sent: number): EmailNotifyState => ({
  day: "2026-11-10",
  sent,
  overflowSent: false,
  pending: [],
  pendingExtra: 0,
  windowEndsAt: null,
});

/** `make` must return a ledger with nothing stored. */
export function notifyLedgerContract(name: string, make: () => Promise<NotifyLedger>): void {
  describe(`NotifyLedger contract: ${name}`, () => {
    it("GivenNothingStored_WhenRead_ThenNull", async () => {
      expect(await (await make()).get()).toBeNull();
    });

    it("GivenAnUpdate_WhenRead_ThenTheNewStateAndResultComeBack", async () => {
      const ledger = await make();
      const result = await ledger.update((s) => ({
        state: state((s?.sent ?? 0) + 1),
        result: "ok",
      }));
      expect(result).toBe("ok");
      expect(await ledger.get()).toEqual(state(1));
    });

    it("GivenConcurrentIncrements_WhenAllFinish_ThenNoneIsLost", async () => {
      const ledger = await make();
      await Promise.all(
        Array.from({ length: 5 }, () =>
          ledger.update((s) => ({ state: state((s?.sent ?? 0) + 1), result: null })),
        ),
      );
      expect((await ledger.get())?.sent).toBe(5);
    });

    it("GivenAnInvalidState_WhenUpdated_ThenRejectedAndNothingChanges", async () => {
      const ledger = await make();
      await ledger.update(() => ({ state: state(2), result: null }));
      await expect(ledger.update(() => ({ state: state(-1), result: null }))).rejects.toThrow();
      expect((await ledger.get())?.sent).toBe(2);
    });
  });
}

export function notifyFlushQueueContract(
  name: string,
  make: () => Promise<NotifyFlushQueue>,
): void {
  describe(`NotifyFlushQueue contract: ${name}`, () => {
    const at = "2026-11-10T13:10:00.000Z";

    it("GivenATime_WhenScheduledTwice_ThenBothResolve", async () => {
      const queue = await make();
      await queue.schedule(at);
      await expect(queue.schedule(at)).resolves.toBeUndefined();
    });

    it("GivenAnInvalidTime_WhenScheduled_ThenRejected", async () => {
      await expect((await make()).schedule("not a time")).rejects.toThrow();
    });
  });
}
