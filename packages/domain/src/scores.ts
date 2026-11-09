import { compareRanks, type Confidence, type Risk, type Size, type Ticket } from "@andy/contracts";

export type Scored = Pick<Ticket, "size" | "risk" | "confidence">;

const RISK_LABELS: Record<Risk, string> = {
  low: "low risk",
  medium: "medium risk",
  high: "high risk",
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "confident",
  medium: "fairly confident",
  low: "not confident",
};

/** The markers a ticket has, in reading order: `{ size: "S", risk: "low risk", confidence: … }`. */
export function scoreMarkers(t: Scored): { size?: Size; risk?: string; confidence?: string } {
  return {
    ...(t.size ? { size: t.size } : {}),
    ...(t.risk ? { risk: RISK_LABELS[t.risk] } : {}),
    ...(t.confidence ? { confidence: CONFIDENCE_LABELS[t.confidence] } : {}),
  };
}

/** One short label the UI and MCP share: "S · low risk · confident"; "" with no scores. */
export function startScore(t: Scored): string {
  return Object.values(scoreMarkers(t)).join(" · ");
}

const SIZE_ORDER: readonly Size[] = ["S", "M", "L"];
const RISK_ORDER: readonly Risk[] = ["low", "medium", "high"];
const CONFIDENCE_ORDER: readonly Confidence[] = ["high", "medium", "low"];

/** Place in `order`; a missing score goes after every real one. */
function place<T>(order: readonly T[], value: T | null): number {
  return value === null ? order.length : order.indexOf(value);
}

/**
 * Easiest wins first: smallest size, then lowest risk, then highest confidence; a missing score
 * sorts last and ties keep board rank. A view only: it returns a new list and writes no rank.
 */
export function sortByStartScore<T extends Scored & Pick<Ticket, "rank">>(tickets: readonly T[]) {
  return [...tickets].sort(
    (a, b) =>
      place(SIZE_ORDER, a.size) - place(SIZE_ORDER, b.size) ||
      place(RISK_ORDER, a.risk) - place(RISK_ORDER, b.risk) ||
      place(CONFIDENCE_ORDER, a.confidence) - place(CONFIDENCE_ORDER, b.confidence) ||
      compareRanks(a.rank, b.rank),
  );
}
