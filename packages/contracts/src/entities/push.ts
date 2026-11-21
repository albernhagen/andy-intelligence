import { z } from "zod";
import { Timestamp } from "./common";

/**
 * Web Push for the installed web app (M7: Mobile, ADR-0052). Storage shapes only: the policy
 * (caps, quiet hours, payloads) is M7.8 in `@andy/domain`, sending is M7.9.
 */

/** What a push is about (ADR-0052). Each is a toggle in the user's push settings. */
export const PushCategory = z.enum([
  "question_asked",
  "plan_waiting",
  "pr_waiting",
  "run_failed",
  "quota",
  "release_ready",
  "dev_verification",
]);
export type PushCategory = z.infer<typeof PushCategory>;

/** Subscriptions (devices) one user may hold; saving another evicts the least recently used. */
export const PUSH_SUBSCRIPTIONS_PER_USER_MAX = 10;

/** A signed-in user's auth uid; the charset keeps it safe as a storage key. */
export const PushUid = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Unpadded base64url, as browsers return a subscription's keys. */
const base64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

/**
 * One browser's push subscription. `endpoint` is untrusted (the client sends it): it is only
 * stored here; the API checks its host before anything calls it (M7.11). Unique per store.
 */
export const PushSubscription = z.object({
  uid: PushUid,
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({ p256dh: base64url(200), auth: base64url(50) }),
  /** A label to tell devices apart, e.g. "iPhone Safari"; untrusted, display only. */
  userAgent: z.string().max(200),
  createdAt: Timestamp,
  /** Last successful send; null until the first. */
  lastUsedAt: Timestamp.nullable(),
});
export type PushSubscription = z.infer<typeof PushSubscription>;

/** "HH:MM", 24-hour clock. */
const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A user's push settings. No document: the policy's defaults apply (M7.8). */
export const PushSettings = z.object({
  uid: PushUid,
  /** No pushes from `start` to `end` in `timeZone` (may wrap midnight); null: none. */
  quietHours: z
    .object({
      start: ClockTime,
      end: ClockTime,
      timeZone: z.string().max(64).refine(isTimeZone, "an IANA time zone"),
    })
    .nullable(),
  /** Categories that push; the rest only reach the inbox. */
  enabledCategories: z
    .array(PushCategory)
    .max(PushCategory.options.length)
    .refine((c) => new Set(c).size === c.length, "no duplicates"),
  updatedAt: Timestamp,
});
export type PushSettings = z.infer<typeof PushSettings>;

/**
 * A user's send counts, for the hourly and daily caps (ADR-0028). Windows are UTC; a new hour
 * or day starts its count at zero (the policy resets it). Each window sends at most one
 * "more waiting" push once its cap is reached.
 */
export const PushSendState = z.object({
  uid: PushUid,
  /** UTC hour the hour count belongs to, "YYYY-MM-DDTHH". */
  hour: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}$/),
  sentThisHour: z.number().int().min(0),
  hourOverflowSent: z.boolean(),
  /** UTC date the day count belongs to, "YYYY-MM-DD". */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sentToday: z.number().int().min(0),
  dayOverflowSent: z.boolean(),
});
export type PushSendState = z.infer<typeof PushSendState>;

/** When a subscription was last useful: its last send, else its creation. */
const lastActive = (s: PushSubscription) => s.lastUsedAt ?? s.createdAt;

/** The subscription a full user loses on the next save: least recently used, ties by endpoint. */
export function pushSubscriptionToEvict(subs: PushSubscription[]): PushSubscription | undefined {
  return [...subs].sort(
    (a, b) =>
      Date.parse(lastActive(a)) - Date.parse(lastActive(b)) || a.endpoint.localeCompare(b.endpoint),
  )[0];
}

/** List order for a user's subscriptions: oldest first, ties by endpoint. */
export function byPushSubscriptionAge(a: PushSubscription, b: PushSubscription): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.endpoint.localeCompare(b.endpoint);
}
