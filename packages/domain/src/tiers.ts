import type { Route, Size, Ticket, TierKey } from "@andy/contracts";
import { effectiveOverrides } from "./overrides";

/**
 * Model tier policy (ADR-0058: tier derived from size; ADR-0050: tiers start inside Claude).
 * The one place that maps size → tier → model; M1.8: Build + gate routes build runs by it.
 */
const claude = (model: string): Route => ({
  harness: "claude-code",
  provider: "claude-sub",
  model,
});

/** Routes for the tiers in use today; `frontier` and `cheap` get theirs with M5 tier config. */
export const TIER_ROUTES = {
  fast: claude("sonnet"),
  strong: claude("opus"),
} as const satisfies Partial<Record<TierKey, Route>>;

/** Typed so every size's tier has a route. */
export const TIER_FOR_SIZE: Record<Size, keyof typeof TIER_ROUTES> = {
  S: "fast",
  M: "strong",
  L: "strong",
};

/**
 * The ticket's tier: `overrides.tier` if pinned on the ticket, else on its epic (AI-116), else
 * from its size; null without a size.
 */
export function tierFor(
  ticket: Pick<Ticket, "size" | "overrides">,
  epic?: Pick<Ticket, "overrides"> | null,
): TierKey | null {
  const pinned = effectiveOverrides(ticket, epic).tier;
  if (pinned) return pinned;
  return ticket.size === null ? null : TIER_FOR_SIZE[ticket.size];
}
