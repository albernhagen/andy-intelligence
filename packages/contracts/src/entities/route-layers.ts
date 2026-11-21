import { z } from "zod";
import { Route, RunStep, TierKey } from "./common";
import { ROUTING_LIMITS, RouteSkip } from "./routing";
import { Worker } from "./worker";

/**
 * Which layer set a ticket's worker, tier and route (AI-282: M9; routing-and-policy.md
 * "Layers"). First match wins: ticket override, epic override, project default, global. A
 * milestone is an epic titled `M<N>: …`. Read-only: it explains a resolution, it never changes one.
 */
export const RouteLayer = z.enum(["ticket", "epic", "project", "global"]);
export type RouteLayer = z.infer<typeof RouteLayer>;

/** The layers in precedence order, with the one name every page, tool and doc uses. */
export const ROUTE_LAYER_NAMES: Record<RouteLayer, string> = {
  ticket: "ticket override",
  epic: "epic override",
  project: "project default",
  global: "global",
};

/** Where one value came from: its layer, the epic's key for `epic`, and a short note. */
const source = {
  layer: RouteLayer,
  /** The epic that set it ("AI-225"); null unless `layer` is `epic`. */
  epicKey: z.string().max(24).nullable(),
  /** What in that layer set it, e.g. "size S → fast" or "the build step's tier". */
  note: z.string().max(200).nullable(),
};

/** A ticket's build worker, tier and route, each with the layer that set it. */
export const TicketRouting = z.object({
  /** The step the tier and route are for: the build, the step dispatch starts. */
  step: RunStep,
  worker: z.object({ value: Worker, ...source }),
  tier: z.object({ value: TierKey, ...source }),
  /** null: no route of the tier can run; a build start is refused. */
  route: z.object({ value: Route.nullable(), ...source }),
  /**
   * Routes passed over before `route`, with the resolver's reason (provider off, can't run, pin
   * not allowed). Quota and spend skips happen at dispatch and are kept on the run (`routeSkips`).
   */
  skipped: z.array(RouteSkip).max(ROUTING_LIMITS.routesPerTier + 1),
});
export type TicketRouting = z.infer<typeof TicketRouting>;
