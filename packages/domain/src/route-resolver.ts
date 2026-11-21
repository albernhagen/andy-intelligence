import {
  ProviderKey,
  TierKey,
  type ProviderRouting,
  type Route,
  type RoutingConfig,
  type RunStep,
} from "@andy/contracts";
import { routeProblem } from "./routing-rules";

/**
 * Route resolution (AI-238: M9.6; routing-and-policy.md). Pure: the caller reads the global and
 * project configs from `RoutingConfigStore` (AI-230: M9.3) and passes them in. Quota and spend
 * aren't checked here: `route-fallback.ts` (AI-261: M10.14) walks `routeCandidates` with them.
 */

/** The routing a project runs under: its config only narrows global. */
export interface EffectiveRouting {
  providers: Record<ProviderKey, ProviderRouting>;
  tiers: Record<TierKey, Route[]>;
  steps: RoutingConfig["steps"];
}

const sameRoute = (a: Route, b: Route) =>
  a.harness === b.harness && a.provider === b.provider && a.model === b.model;

/** The lower of two daily task limits; null is no limit. */
function lowerLimit(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function narrowProvider(global: ProviderRouting, project: ProviderRouting): ProviderRouting {
  return {
    enabled: global.enabled && project.enabled,
    reservePct: Math.max(global.reservePct, project.reservePct),
    warnPct: Math.min(global.warnPct, project.warnPct),
    pausePct: Math.min(global.pausePct, project.pausePct),
    dailyTaskLimit: lowerLimit(global.dailyTaskLimit, project.dailyTaskLimit),
  };
}

/**
 * "Global is the ceiling; a project can only narrow it." A provider is on only if both have it
 * on; the higher reserve and the lower warn, pause and task limit win. A project's tier keeps
 * only routes global's tier also has, in the project's order (it may drop or reorder, never
 * add); none left means the tier has no route for that project. A project's `steps` are an
 * explicit override, not a narrowing: a project config holds every step, so a later change to
 * global's steps doesn't reach a project that has its own config.
 */
export function effectiveRouting(
  global: RoutingConfig,
  project: RoutingConfig | null,
): EffectiveRouting {
  if (!project) {
    return { providers: global.providers, tiers: global.tiers, steps: global.steps };
  }
  const providers = Object.fromEntries(
    ProviderKey.options.map((k) => [k, narrowProvider(global.providers[k], project.providers[k])]),
  ) as Record<ProviderKey, ProviderRouting>;
  const tiers = Object.fromEntries(
    TierKey.options.map((k) => [
      k,
      project.tiers[k].filter((r) => global.tiers[k].some((g) => sameRoute(g, r))),
    ]),
  ) as Record<TierKey, Route[]>;
  return { providers, tiers, steps: project.steps };
}

/** A route not taken, and why. */
export interface SkippedRoute {
  route: Route;
  reason: string;
}

export type ResolvedRoute =
  | { route: Route; tier: TierKey; skipped: SkippedRoute[] }
  | { route: null; tier: TierKey; skipped: SkippedRoute[] };

const label = (r: Route) => `${r.harness}/${r.provider}/${r.model}`;

/**
 * Why `route` would be skipped with these providers, or null: its provider is off, or it can't
 * run (`routeProblem`). The settings page shows the same reason (AI-243: M9.8).
 */
export function routeSkipReason(
  route: Route,
  providers: Record<ProviderKey, ProviderRouting>,
): string | null {
  if (!providers[route.provider].enabled) return `provider ${route.provider} is off`;
  return routeProblem(route);
}

/** Why `route` can't run under `routing`, or null. */
function unusable(route: Route, routing: EffectiveRouting): string | null {
  return routeSkipReason(route, routing.providers);
}

/** A pin must be one of the routes some tier allows: global is the ceiling for pins too. */
function pinProblem(pin: Route, routing: EffectiveRouting): string | null {
  const allowed = TierKey.options.some((k) => routing.tiers[k].some((r) => sameRoute(r, pin)));
  return allowed ? unusable(pin, routing) : "not a route in this project's routing";
}

/** A route a step may try, with why it can't run (null: it can) (AI-261: M10.14). */
export interface RouteCandidate {
  route: Route;
  problem: string | null;
}

/**
 * The routes a step tries, in order, each with its problem. Its tier is the step's
 * (`steps[step]`), or the ticket's (`ticketTier`, from size or pin) when the step is `by_size`. On
 * a `by_size` step a ticket's `modelPin` comes first; it can run only if it is usable and is a
 * route of some tier in `routing` (so a pin can't reach a model the project's routing leaves
 * out). Then the tier's routes in order.
 */
export function routeCandidates(
  step: RunStep,
  ticketTier: TierKey,
  routing: EffectiveRouting,
  pin?: Route,
): { tier: TierKey; candidates: RouteCandidate[] } {
  const stepTier = routing.steps[step];
  const tier = stepTier === "by_size" ? ticketTier : stepTier;
  const pinned: RouteCandidate[] = [];
  if (pin && stepTier === "by_size") {
    const problem = pinProblem(pin, routing);
    pinned.push({ route: pin, problem: problem && `the ticket's model pin: ${problem}` });
  }
  const tierRoutes = routing.tiers[tier].map((route) => ({
    route,
    problem: unusable(route, routing),
  }));
  return { tier, candidates: [...pinned, ...tierRoutes] };
}

/**
 * The route a step runs on: the first candidate that can run, with every route passed over
 * before it and its reason. `route: null` when none can: the caller refuses to start.
 */
export function resolveRoute(
  step: RunStep,
  ticketTier: TierKey,
  routing: EffectiveRouting,
  pin?: Route,
): ResolvedRoute {
  const { tier, candidates } = routeCandidates(step, ticketTier, routing, pin);
  const skipped: SkippedRoute[] = [];
  for (const { route, problem } of candidates) {
    if (problem === null) return { route, tier, skipped };
    skipped.push({ route, reason: problem });
  }
  return { route: null, tier, skipped };
}

/** One line for a ticket comment or a refusal: each skipped route and its reason. */
export function skippedText(skipped: SkippedRoute[]): string {
  return skipped.map((s) => `${label(s.route)} skipped: ${s.reason}`).join("; ");
}
