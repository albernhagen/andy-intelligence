import { ROUTE_LAYER_NAMES, RouteLayer } from "@andy/contracts";

/**
 * The words for routing layers (AI-282: M9; routing-and-policy.md "Layers"), shared by the
 * ticket panel and the settings pages so every page says the same thing.
 */

/** The four layers in order: one line for Settings → Models and project settings. */
export const LAYER_ORDER_LINE = `Who sets a ticket's worker, tier and route, first match wins: ${RouteLayer.options
  .map((l) => ROUTE_LAYER_NAMES[l])
  .join(", then ")}.`;

/** "project default", or "epic override AI-225" naming the epic. */
export function layerText(src: { layer: RouteLayer; epicKey: string | null }): string {
  const name = ROUTE_LAYER_NAMES[src.layer];
  return src.layer === "epic" && src.epicKey ? `${name} ${src.epicKey}` : name;
}
