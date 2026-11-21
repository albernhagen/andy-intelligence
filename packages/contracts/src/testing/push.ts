import { describe, expect, it } from "vitest";
import {
  PUSH_SUBSCRIPTIONS_PER_USER_MAX,
  type PushSendState,
  type PushSettings,
  type PushSubscription,
} from "../entities/push";
import type { PushSubscriptionStore } from "../ports/push";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 12, minute)).toISOString();

export const pushSubscription = (
  n: number,
  over: Partial<PushSubscription> = {},
): PushSubscription => ({
  uid: "uid-a",
  endpoint: `https://push.example.com/send/${n}`,
  keys: { p256dh: `p256dh${n}`, auth: `auth${n}` },
  userAgent: "iPhone Safari",
  createdAt: at(n),
  lastUsedAt: null,
  ...over,
});

const settings = (over: Partial<PushSettings> = {}): PushSettings => ({
  uid: "uid-a",
  quietHours: { start: "22:00", end: "07:00", timeZone: "America/Denver" },
  enabledCategories: ["question_asked", "plan_waiting"],
  updatedAt: at(0),
  ...over,
});

const sendState = (sentThisHour: number, uid = "uid-a"): PushSendState => ({
  uid,
  hour: "2026-11-20T12",
  sentThisHour,
  hourOverflowSent: false,
  day: "2026-11-20",
  sentToday: sentThisHour,
  dayOverflowSent: false,
});

const increment =
  (uid = "uid-a") =>
  (s: PushSendState | null) => ({
    state: sendState((s?.sentThisHour ?? 0) + 1, uid),
    result: null,
  });

export interface PushSubscriptionStoreContractOptions {
  /** Timeout (ms) for cases that race transactions; see `NotifyLedgerContractOptions` (AI-138). */
  raceTimeoutMs?: number;
}

/** `make` must return a store with nothing in it. */
export function pushSubscriptionStoreContract(
  name: string,
  make: () => Promise<PushSubscriptionStore>,
  options: PushSubscriptionStoreContractOptions = {},
): void {
  const itRaces = (title: string, fn: () => Promise<void>) => it(title, fn, options.raceTimeoutMs);
  const endpoints = (subs: PushSubscription[]) => subs.map((s) => s.endpoint);

  describe(`PushSubscriptionStore contract: ${name}`, () => {
    it("GivenNothingStored_WhenListed_ThenNone", async () => {
      expect(await (await make()).listByUid("uid-a")).toEqual([]);
    });

    it("GivenSavedSubscriptions_WhenListed_ThenOnlyThatUsersOldestFirst", async () => {
      const store = await make();
      await store.save(pushSubscription(2));
      await store.save(pushSubscription(1));
      await store.save(pushSubscription(3, { uid: "uid-b" }));
      expect(await store.listByUid("uid-a")).toEqual([pushSubscription(1), pushSubscription(2)]);
      expect(endpoints(await store.listByUid("uid-b"))).toEqual([pushSubscription(3).endpoint]);
    });

    it("GivenAnExistingEndpoint_WhenSavedAgain_ThenReplacedNotAdded", async () => {
      const store = await make();
      await store.save(pushSubscription(1));
      const renewed = pushSubscription(1, { keys: { p256dh: "newKey", auth: "newAuth" } });
      await store.save(renewed);
      expect(await store.listByUid("uid-a")).toEqual([renewed]);
    });

    it("GivenAnEndpointHeldByAnotherUser_WhenSaved_ThenItMovesToTheNewUser", async () => {
      const store = await make();
      await store.save(pushSubscription(1, { uid: "uid-b" }));
      await store.save(pushSubscription(1));
      expect(await store.listByUid("uid-b")).toEqual([]);
      expect(await store.listByUid("uid-a")).toEqual([pushSubscription(1)]);
    });

    it("GivenAnInvalidSubscription_WhenSaved_ThenRejectedAndNothingStored", async () => {
      const store = await make();
      await expect(
        store.save(pushSubscription(1, { endpoint: "http://push.example.com/plain" })),
      ).rejects.toThrow();
      await expect(
        store.save(pushSubscription(2, { keys: { p256dh: "not base64url!", auth: "a" } })),
      ).rejects.toThrow();
      expect(await store.listByUid("uid-a")).toEqual([]);
    });

    it("GivenAFullUser_WhenANewEndpointIsSaved_ThenTheLeastRecentlyUsedIsEvicted", async () => {
      const store = await make();
      const max = PUSH_SUBSCRIPTIONS_PER_USER_MAX;
      // Subscription 0 is the oldest but was used last, so 1 is the least recently used.
      await store.save(pushSubscription(0, { lastUsedAt: at(59) }));
      for (let n = 1; n < max; n++) await store.save(pushSubscription(n));
      await store.save(pushSubscription(max));
      const left = endpoints(await store.listByUid("uid-a"));
      expect(left).toHaveLength(max);
      expect(left).not.toContain(pushSubscription(1).endpoint);
      expect(left).toContain(pushSubscription(0).endpoint);
      expect(left).toContain(pushSubscription(max).endpoint);
    });

    it("GivenAFullUser_WhenAnExistingEndpointIsSaved_ThenNothingIsEvicted", async () => {
      const store = await make();
      const max = PUSH_SUBSCRIPTIONS_PER_USER_MAX;
      for (let n = 0; n < max; n++) await store.save(pushSubscription(n));
      await store.save(pushSubscription(max - 1, { lastUsedAt: at(59) }));
      expect(await store.listByUid("uid-a")).toHaveLength(max);
    });

    itRaces("GivenConcurrentSavesPastTheMax_WhenAllFinish_ThenTheUserHoldsTheMax", async () => {
      const store = await make();
      const max = PUSH_SUBSCRIPTIONS_PER_USER_MAX;
      await Promise.all(Array.from({ length: max + 3 }, (_, n) => store.save(pushSubscription(n))));
      expect(await store.listByUid("uid-a")).toHaveLength(max);
    });

    it("GivenASubscription_WhenDeletedByEndpoint_ThenGoneAndASecondDeleteIsFalse", async () => {
      const store = await make();
      await store.save(pushSubscription(1));
      await store.save(pushSubscription(2));
      expect(await store.deleteByEndpoint(pushSubscription(1).endpoint)).toBe(true);
      expect(await store.deleteByEndpoint(pushSubscription(1).endpoint)).toBe(false);
      expect(await store.listByUid("uid-a")).toEqual([pushSubscription(2)]);
    });

    it("GivenAUsersSubscriptions_WhenAllDeleted_ThenNoneListAndOthersStay", async () => {
      const store = await make();
      await store.save(pushSubscription(1));
      await store.save(pushSubscription(2));
      await store.save(pushSubscription(3, { uid: "uid-b" }));
      expect(await store.deleteAllForUid("uid-a")).toBe(2);
      expect(await store.listByUid("uid-a")).toEqual([]);
      expect(await store.listByUid("uid-b")).toHaveLength(1);
      expect(await store.deleteAllForUid("uid-a")).toBe(0);
    });

    it("GivenAUidThatIsNotAKey_WhenUsed_ThenRejected", async () => {
      const store = await make();
      await expect(store.listByUid("a/b")).rejects.toThrow();
      await expect(store.deleteAllForUid("..")).rejects.toThrow();
      await expect(store.getSettings("")).rejects.toThrow();
      await expect(store.updateSendState("a/b", increment("a/b"))).rejects.toThrow();
    });

    it("GivenNoSettings_WhenRead_ThenNull", async () => {
      expect(await (await make()).getSettings("uid-a")).toBeNull();
    });

    it("GivenSettings_WhenPutTwice_ThenTheLastComeBackPerUser", async () => {
      const store = await make();
      await store.putSettings(settings());
      const next = settings({ quietHours: null, enabledCategories: [], updatedAt: at(5) });
      await store.putSettings(next);
      await store.putSettings(settings({ uid: "uid-b" }));
      expect(await store.getSettings("uid-a")).toEqual(next);
      expect(await store.getSettings("uid-b")).toEqual(settings({ uid: "uid-b" }));
    });

    it("GivenInvalidSettings_WhenPut_ThenRejectedAndNothingChanges", async () => {
      const store = await make();
      await store.putSettings(settings());
      const badZone = settings({
        quietHours: { start: "22:00", end: "07:00", timeZone: "Mars/Base" },
      });
      await expect(store.putSettings(badZone)).rejects.toThrow();
      const twice = settings({ enabledCategories: ["quota", "quota"] });
      await expect(store.putSettings(twice)).rejects.toThrow();
      expect(await store.getSettings("uid-a")).toEqual(settings());
    });

    it("GivenNoSendState_WhenUpdated_ThenChangeSeesNullAndTheResultComesBack", async () => {
      const store = await make();
      let seen: PushSendState | null | undefined;
      const result = await store.updateSendState("uid-a", (s) => {
        seen = s;
        return { state: sendState(1), result: "sent" };
      });
      expect(seen).toBeNull();
      expect(result).toBe("sent");
      expect(await store.updateSendState("uid-a", (s) => ({ state: s!, result: s }))).toEqual(
        sendState(1),
      );
    });

    itRaces("GivenConcurrentSends_WhenAllFinish_ThenNoCountIsLost", async () => {
      const store = await make();
      await Promise.all(
        Array.from({ length: 5 }, () => store.updateSendState("uid-a", increment())),
      );
      await store.updateSendState("uid-b", increment("uid-b"));
      const read = (uid: string) =>
        store.updateSendState(uid, (s) => ({ state: s!, result: s?.sentThisHour }));
      expect(await read("uid-a")).toBe(5);
      expect(await read("uid-b")).toBe(1);
    });

    it("GivenAnInvalidOrMisaddressedState_WhenUpdated_ThenRejectedAndNothingChanges", async () => {
      const store = await make();
      await store.updateSendState("uid-a", () => ({ state: sendState(2), result: null }));
      await expect(
        store.updateSendState("uid-a", () => ({ state: sendState(-1), result: null })),
      ).rejects.toThrow();
      await expect(
        store.updateSendState("uid-a", () => ({ state: sendState(3, "uid-b"), result: null })),
      ).rejects.toThrow();
      expect(
        await store.updateSendState("uid-a", (s) => ({ state: s!, result: s?.sentThisHour })),
      ).toBe(2);
    });
  });
}
