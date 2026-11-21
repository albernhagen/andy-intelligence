import type { EffectiveSpendCaps, Notice, SpendCapKey, SpendSoFar } from "@andy/contracts";
import { formatMicroUsd } from "./spend-settings";

/**
 * Spend notices for the Needs-you inbox (AI-257: M10.9, ADR-0129). Two kinds: a scope that has
 * used 80% of a daily or monthly cap, and a scope stopped at a cap with what is waiting. Each is
 * sent once per cap and window, and at most SPEND_NOTICES_PER_DAY a UTC day go out (ADR-0028).
 * Pure: the caller keeps `SpendNoticeState` and sends the returned notices. Only numbers, keys
 * and fixed phrases reach a notice: no agent-written text.
 */

/** A window cap warns at this share of its limit. */
export const SPEND_WARN_PCT = 80;
/** Notices a UTC day, both kinds together; the rest are dropped (the panel still shows them). */
export const SPEND_NOTICES_PER_DAY = 10;
/** Waiting ticket keys a stop notice names; the rest are counted. */
export const SPEND_STOP_KEYS_MAX = 5;
/** Sent keys kept; old windows are pruned first, so this only bounds a pathological state. */
const SENT_KEYS_MAX = 200;

const PROJECT_KEY = /^[A-Z][A-Z0-9]{0,9}$/;
const TICKET_KEY = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/;
const PROJECT_ID = /^[a-z][a-z0-9]{0,9}$/;

/** What has gone out: dedupe keys for the current day and month, and today's count. */
export interface SpendNoticeState {
  /** UTC date the count belongs to. */
  day: string;
  sentToday: number;
  /** `kind|cap|scope|window` keys already sent; windows other than today and this month are pruned. */
  sent: string[];
}

/** A scope stopped at a cap (from the spend gate, M10.7), and the tickets it holds back. */
export interface SpendStop {
  cap: SpendCapKey;
  waiting: readonly string[];
}

export interface SpendNoticeInput {
  project: { id: string; key: string };
  caps: EffectiveSpendCaps;
  /** Null when the ledger couldn't be read: nothing warns (the gate stops on unknown spend). */
  spent: SpendSoFar | null;
  stop: SpendStop | null;
  /** The app's origin, for the link to the project's Dashboards. */
  appUrl: string;
}

type WindowCap = Exclude<SpendCapKey, "per_task">;
const WINDOW_CAPS: readonly WindowCap[] = [
  "project_daily",
  "project_monthly",
  "global_daily",
  "global_monthly",
];

const LABEL: Record<SpendCapKey, string> = {
  per_task: "per-task",
  project_daily: "daily",
  project_monthly: "monthly",
  global_daily: "global daily",
  global_monthly: "global monthly",
};

const isDaily = (cap: SpendCapKey) => cap.endsWith("_daily") || cap === "per_task";
const isGlobal = (cap: SpendCapKey) => cap.startsWith("global_");

function usedOf(cap: WindowCap, spent: SpendSoFar): number {
  switch (cap) {
    case "project_daily":
      return spent.project.dayMicroUsd;
    case "project_monthly":
      return spent.project.monthMicroUsd;
    case "global_daily":
      return spent.global.dayMicroUsd;
    case "global_monthly":
      return spent.global.monthMicroUsd;
  }
}

/** The fresh state for `now`'s day: yesterday's count resets, other windows' keys go. */
function roll(state: SpendNoticeState | null, now: Date): SpendNoticeState {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const live = (key: string) => {
    const window = key.slice(key.lastIndexOf("|") + 1);
    return window === day || window === month;
  };
  const sent = (state?.sent ?? []).filter(live).slice(-SENT_KEYS_MAX);
  return state?.day === day
    ? { day, sentToday: state.sentToday, sent }
    : { day, sentToday: 0, sent };
}

/**
 * The notices to send now for one project, and the state to keep. Global caps are keyed without
 * the project, so the global 80% notice goes out once whichever project reaches it first.
 */
export function spendNotices(
  input: SpendNoticeInput,
  state: SpendNoticeState | null,
  now: Date,
): { state: SpendNoticeState; notices: Notice[] } {
  if (!PROJECT_KEY.test(input.project.key) || !PROJECT_ID.test(input.project.id)) {
    throw new Error("spend notice needs a project key and id");
  }
  const s = roll(state, now);
  const day = s.day;
  const month = day.slice(0, 7);
  const link = new URL(
    `/p/${input.project.id}/dashboards`,
    new URL(input.appUrl).origin,
  ).toString();
  const notices: Notice[] = [];
  const sent = new Set(s.sent);
  let sentToday = s.sentToday;

  const offer = (key: string, notice: Notice) => {
    if (sent.has(key) || sentToday >= SPEND_NOTICES_PER_DAY) return;
    sent.add(key);
    sentToday += 1;
    notices.push(notice);
  };
  const keyOf = (kind: "warn" | "stop", cap: SpendCapKey) =>
    `${kind}|${cap}|${isGlobal(cap) ? "global" : input.project.id}|${isDaily(cap) ? day : month}`;
  const scopeName = (cap: SpendCapKey) => (isGlobal(cap) ? "All projects" : input.project.key);
  const period = (cap: SpendCapKey) => (isDaily(cap) ? "today (UTC)" : "this month (UTC)");

  // A stop first: it matters more than a warning, and the daily count may have room for one.
  if (input.stop) {
    const { cap, waiting } = input.stop;
    const keys = waiting.filter((k) => TICKET_KEY.test(k));
    const named = keys.slice(0, SPEND_STOP_KEYS_MAX);
    const more = keys.length - named.length;
    const what =
      keys.length === 0
        ? "Nothing is queued yet."
        : `Waiting: ${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`;
    offer(keyOf("stop", cap), {
      title: `${scopeName(cap)}: paid tasks stopped at the ${LABEL[cap]} spend cap`,
      body: `${what} Raise the cap in project settings or wait for the next window.`,
      urgency: "high",
      link,
    });
  }

  if (input.spent) {
    for (const cap of WINDOW_CAPS) {
      const limit = input.caps[cap];
      const used = usedOf(cap, input.spent);
      // A zero cap means paid spend is off, not that it is 80% used.
      if (limit === 0 || used * 100 < limit * SPEND_WARN_PCT) continue;
      offer(keyOf("warn", cap), {
        title: `${scopeName(cap)}: ${SPEND_WARN_PCT}% of the ${LABEL[cap]} spend cap`,
        body: `${formatMicroUsd(used)} of ${formatMicroUsd(limit)} spent ${period(cap)}.`,
        urgency: "normal",
        link,
      });
    }
  }

  return { state: { day, sentToday, sent: [...sent].slice(-SENT_KEYS_MAX) }, notices };
}
