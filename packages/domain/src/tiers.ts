import { DEFAULT_ROUTING, type Route, type Size, type Ticket, type TierKey } from "@andy/contracts";
import { effectiveOverrides } from "./overrides";

/**
 * Model tier policy (ADR-0058: tier derived from size; ADR-0050: tiers start inside Claude).
 * Size → tier lives here; tier → route comes from the stored routing config (AI-238: M9.6,
 * `resolveRoute` in route-resolver.ts).
 */

/**
 * The default config's first route for the two tiers sizes map to (Sonnet, Opus). For labels and
 * fixtures only: runs are routed by `resolveRoute`.
 */
export const TIER_ROUTES = {
  fast: DEFAULT_ROUTING.tiers.fast[0]!,
  strong: DEFAULT_ROUTING.tiers.strong[0]!,
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
