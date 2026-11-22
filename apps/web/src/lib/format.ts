import { durationText } from "@andy/domain";

/**
 * Times, durations and counts as words (AI-329): no seconds, short month names, thousands
 * separators. Every screen formats through these so the same thing always reads the same way.
 */

const TIME = { hour: "numeric", minute: "2-digit" } as const;

/** "2:48 PM". */
export const timeOfDay = (iso: string) => new Date(iso).toLocaleTimeString("en-US", TIME);

/** "Nov 4, 2:50 PM". */
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", ...TIME });

/** "Nov 4, 2026". */
export const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "5,000,000". */
export const count = (n: number) => n.toLocaleString("en-US");

/** "45 s", "12 min 5 s", then words past 90 minutes: "3 hours", "2 days". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m >= 90) return durationText(m);
  return s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
}
