import { PushCategory, type PushSendState, type PushSettings } from "@andy/contracts";

/**
 * Push policy (M7.8, ADR-0052, ADR-0115 Q3 and Q4). Pure rules for one push: what it says, whether
 * the user's settings let it through, and the hourly and daily caps (ADR-0028). M7.13's notifier
 * runs `takePushSlot` inside `PushSubscriptionStore.updateSendState`, so concurrent sends can't
 * both pass a cap. No I/O here.
 */

/** Pushes per UTC hour and per UTC day, the "more waiting" pushes excluded (ADR-0115 Q3). */
export const PUSH_HOURLY_CAP = 6;
export const PUSH_DAILY_CAP = 30;

/** Default quiet hours, used until the user saves settings (ADR-0115 Q3). */
export const PUSH_DEFAULT_QUIET_START = "22:00";
export const PUSH_DEFAULT_QUIET_END = "07:00";
/** Placeholder until Andy names his time zone (ADR-0115 Q3); his saved settings override it. */
export const PUSH_DEFAULT_TIME_ZONE = "UTC";

/**
 * What happened, one level finer than `PushCategory`: quota warn and quota pause share the
 * `quota` toggle, but only a pause breaks through quiet hours (ADR-0115 Q3).
 */
export type PushKind =
  | "question_asked"
  | "plan_waiting"
  | "pr_waiting"
  | "run_failed"
  | "quota_warn"
  | "quota_paused"
  | "release_ready"
  | "dev_verification";

const KINDS: Record<PushKind, { category: PushCategory; phrase: string }> = {
  question_asked: { category: "question_asked", phrase: "Question waiting" },
  plan_waiting: { category: "plan_waiting", phrase: "Plan waiting" },
  pr_waiting: { category: "pr_waiting", phrase: "PR waiting" },
  run_failed: { category: "run_failed", phrase: "Run failed" },
  quota_warn: { category: "quota", phrase: "Quota running low" },
  quota_paused: { category: "quota", phrase: "Dispatch paused for quota" },
  release_ready: { category: "release_ready", phrase: "Release ready" },
  dev_verification: { category: "dev_verification", phrase: "Dev verification finished" },
};

/** Kinds that still push inside quiet hours. */
const BREAKS_QUIET: ReadonlySet<PushKind> = new Set(["quota_paused"]);

export const pushCategoryOf = (kind: PushKind): PushCategory => KINDS[kind].category;

/** The "more waiting" push sent once per capped window. */
export const PUSH_OVERFLOW_PHRASE = "More items need you";
const INBOX_PATH = "/all/inbox";

/**
 * One thing to push. Only structured fields: there is no place for a ticket title, question
 * text or run output, so agent-written text can't reach a lock screen (ADR-0115 Q4).
 */
export interface PushNotice {
  kind: PushKind;
  /** Project key, e.g. "AI". */
  projectKey: string;
  /** Ticket key, e.g. "AI-150"; null for project-wide notices (quota, release). */
  ticketKey: string | null;
  /** Same-origin path the tap opens, e.g. "/p/ai/t/AI-150". */
  path: string;
}

/** What the sender (M7.9) encrypts and delivers. */
export interface PushPayload {
  title: string;
  body: string;
  /** Absolute URL on the app's own origin. */
  link: string;
  /** Lets the device replace an older push about the same item. */
  tag: string;
}

const PROJECT_KEY = /^[A-Z][A-Z0-9]{0,9}$/;
const TICKET_KEY = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/;
/** A plain path: no scheme, no `//` host, no backslash, no control or space characters. */
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/?=&%]*$/;

/** `appUrl` + `path`, refused unless it stays on `appUrl`'s origin. */
function sameOriginLink(appUrl: string, path: string): string {
  if (!SAFE_PATH.test(path)) throw new Error(`push path is not a plain same-origin path: ${path}`);
  const origin = new URL(appUrl).origin;
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error(`push link leaves ${origin}`);
  return url.toString();
}

/**
 * The push for one notice: "AI-150 · Question waiting", body "Project AI". Keys are checked
 * against their formats, so nothing free-form gets in.
 */
export function buildPushPayload(notice: PushNotice, appUrl: string): PushPayload {
  if (!PROJECT_KEY.test(notice.projectKey)) throw new Error("push needs a project key");
  if (notice.ticketKey !== null && !TICKET_KEY.test(notice.ticketKey)) {
    throw new Error("push needs a ticket key or null");
  }
  const phrase = KINDS[notice.kind].phrase;
  return {
    title: notice.ticketKey ? `${notice.ticketKey} · ${phrase}` : phrase,
    body: `Project ${notice.projectKey}`,
    link: sameOriginLink(appUrl, notice.path),
    tag: `${notice.kind}:${notice.ticketKey ?? notice.projectKey}`,
  };
}

/** The once-per-window push that replaces everything over a cap. */
export function buildOverflowPayload(appUrl: string): PushPayload {
  return {
    title: PUSH_OVERFLOW_PHRASE,
    body: "Open the inbox",
    link: sameOriginLink(appUrl, INBOX_PATH),
    tag: "overflow",
  };
}

/** Settings for a user who hasn't saved any: default quiet hours, every category on. */
export function defaultPushSettings(uid: string, now: Date): PushSettings {
  return {
    uid,
    quietHours: {
      start: PUSH_DEFAULT_QUIET_START,
      end: PUSH_DEFAULT_QUIET_END,
      timeZone: PUSH_DEFAULT_TIME_ZONE,
    },
    enabledCategories: [...PushCategory.options],
    updatedAt: now.toISOString(),
  };
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minutes since local midnight at `now` in `timeZone`; follows daylight-saving changes. */
function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") * 60 + get("minute");
}

/** Inside quiet hours: from `start` (included) to `end` (excluded), wrapping midnight. */
export function inQuietHours(quiet: PushSettings["quietHours"], now: Date): boolean {
  if (!quiet) return false;
  const start = minutes(quiet.start);
  const end = minutes(quiet.end);
  if (start === end) return false;
  const m = localMinutes(now, quiet.timeZone);
  return start < end ? m >= start && m < end : m >= start || m < end;
}

export type PushGate = "allowed" | "disabled" | "quiet_hours";

/**
 * Whether the user's settings let this kind through now. A disabled category sends nothing;
 * quiet hours drop everything but a quota pause (dropped, not delayed: the inbox and email
 * keep it). Null settings: the defaults.
 */
export function pushGate(
  kind: PushKind,
  settings: PushSettings | null,
  uid: string,
  now: Date,
): PushGate {
  const s = settings ?? defaultPushSettings(uid, now);
  if (!s.enabledCategories.includes(pushCategoryOf(kind))) return "disabled";
  if (!BREAKS_QUIET.has(kind) && inQuietHours(s.quietHours, now)) return "quiet_hours";
  return "allowed";
}

const utcHour = (now: Date) => now.toISOString().slice(0, 13);
const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** A new UTC hour or day starts its count and its overflow flag again. */
function rollWindows(state: PushSendState | null, uid: string, now: Date): PushSendState {
  const hour = utcHour(now);
  const day = utcDay(now);
  const s = state ?? {
    uid,
    hour,
    sentThisHour: 0,
    hourOverflowSent: false,
    day,
    sentToday: 0,
    dayOverflowSent: false,
  };
  return {
    ...s,
    ...(s.hour === hour ? {} : { hour, sentThisHour: 0, hourOverflowSent: false }),
    ...(s.day === day ? {} : { day, sentToday: 0, dayOverflowSent: false }),
  };
}

/**
 * `send`: push it. `overflow`: push the "more waiting" push instead (once per capped window).
 * `held`: push nothing; the inbox and email still have it.
 */
export type PushSlot =
  | { kind: "send" }
  | { kind: "overflow"; cap: "hour" | "day" }
  | { kind: "held"; cap: "hour" | "day" };

/**
 * Takes a slot under the hourly and daily caps. Pure: pass it to
 * `PushSubscriptionStore.updateSendState`. The daily cap is checked first, so a full day never
 * sends an hourly overflow.
 */
export function takePushSlot(
  state: PushSendState | null,
  uid: string,
  now: Date,
): { state: PushSendState; result: PushSlot } {
  const s = rollWindows(state, uid, now);
  if (s.sentToday >= PUSH_DAILY_CAP) {
    if (s.dayOverflowSent) return { state: s, result: { kind: "held", cap: "day" } };
    return { state: { ...s, dayOverflowSent: true }, result: { kind: "overflow", cap: "day" } };
  }
  if (s.sentThisHour >= PUSH_HOURLY_CAP) {
    if (s.hourOverflowSent) return { state: s, result: { kind: "held", cap: "hour" } };
    return { state: { ...s, hourOverflowSent: true }, result: { kind: "overflow", cap: "hour" } };
  }
  return {
    state: { ...s, sentThisHour: s.sentThisHour + 1, sentToday: s.sentToday + 1 },
    result: { kind: "send" },
  };
}
