import type {
  Project,
  RouteLayer,
  RoutingConfig,
  RunStep,
  Ticket,
  TicketOverrides,
  TicketRouting,
} from "@andy/contracts";
import { buildRoute } from "./builds";
import { withEpicOverrides } from "./overrides";
import { effectiveRouting } from "./route-resolver";
import { TIER_FOR_SIZE } from "./tiers";
import { resolveWorker } from "./worker";

/**
 * Which layer set a ticket's worker, tier and route (AI-282: M9; routing-and-policy.md
 * "Layers"): ticket override, then epic override, then project default, then global. Pure and
 * read-only: the values come from the same functions dispatch uses (`resolveWorker`,
 * `buildRoute`), so this explains a resolution and can't disagree with it.
 */

type LayerTicket = Pick<Ticket, "size" | "overrides">;
type LayerEpic = Pick<Ticket, "key" | "overrides"> | null;

interface Source {
  layer: RouteLayer;
  epicKey: string | null;
  note: string | null;
}

/** The ticket's own value wins, then its epic's; null when neither set `field`. */
function overrideSource(
  field: keyof TicketOverrides,
  ticket: LayerTicket,
  epic: LayerEpic,
): Source | null {
  if (ticket.overrides[field] !== undefined) return { layer: "ticket", epicKey: null, note: null };
  if (epic && epic.overrides[field] !== undefined) {
    return { layer: "epic", epicKey: epic.key, note: null };
  }
  return null;
}

/** The routing config the project runs under: its own when it has one, else global's. */
const configLayer = (projectConfig: RoutingConfig | null): RouteLayer =>
  projectConfig ? "project" : "global";

export function routeLayers(input: {
  ticket: LayerTicket;
  /** The ticket's epic when its overrides cascade (`cascadesFrom`), else null. */
  epic: LayerEpic;
  project: Pick<Project, "defaultWorker">;
  global: RoutingConfig;
  /** The project's own routing config; null when it follows global. */
  projectConfig: RoutingConfig | null;
  step?: RunStep;
}): TicketRouting {
  const { ticket, epic, project, global, projectConfig } = input;
  const step = input.step ?? "build";
  const routing = effectiveRouting(global, projectConfig);
  const merged = withEpicOverrides(ticket, epic);
  const resolved = buildRoute(merged, routing, step);

  const workerSource: Source = overrideSource("assignee", ticket, epic) ?? {
    layer: "project",
    epicKey: null,
    note: null,
  };

  const stepTier = routing.steps[step];
  const tierSource: Source =
    stepTier !== "by_size"
      ? { layer: configLayer(projectConfig), epicKey: null, note: `the ${step} step's tier` }
      : (overrideSource("tier", ticket, epic) ?? {
          layer: "global",
          epicKey: null,
          note:
            ticket.size === null
              ? "no size yet, so fast"
              : `size ${ticket.size} → ${TIER_FOR_SIZE[ticket.size]}`,
        });

  // A usable pin is the first candidate, so it is the route exactly when nothing was skipped
  // before it; a skipped pin leaves the route to the tier's list.
  const pinSource = overrideSource("modelPin", ticket, epic);
  const pinRan =
    pinSource !== null &&
    stepTier === "by_size" &&
    resolved.route !== null &&
    resolved.skipped.length === 0;
  const routeSource: Source = pinRan
    ? { ...pinSource, note: "model pin" }
    : {
        layer: configLayer(projectConfig),
        epicKey: null,
        note: `first usable route of the ${resolved.tier} tier`,
      };

  return {
    step,
    worker: { value: resolveWorker(ticket, project, epic), ...workerSource },
    tier: { value: resolved.tier, ...tierSource },
    route: { value: resolved.route, ...routeSource },
    skipped: resolved.skipped,
  };
}
