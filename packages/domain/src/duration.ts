/**
 * A duration in words for people (AI-329): minutes up to 90, then hours up to 48, then days,
 * rounded down. "17 days", never "25239 min".
 */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return plural(h, "hour");
  return plural(Math.floor(h / 24), "day");
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
