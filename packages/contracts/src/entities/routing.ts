import { z } from "zod";
import { ProviderKey, Route, RunStep, TierKey, Timestamp } from "./common";

/**
 * Model routing config (M9: Add Jules + model routing, AI-230: M9.3). One stored document for
 * global, and at most one per project: which providers are on and their quota levels, each
 * tier's ordered routes, and which tier each run step uses. Storage and shape only: route
 * compatibility (M9.4), project narrowing and route choice (M9.6) live in @andy/domain.
 */

/** Caps (ADR-0028): a tier tries at most this many routes. */
export const ROUTING_LIMITS = { routesPerTier: 5, dailyTaskLimit: 10_000 } as const;

/**
 * A project id: the project key lowercased (`projectIdFor`), so never a `/` that would split a
 * stored document's path.
 */
export const RoutingProjectId = z.string().regex(/^[a-z][a-z0-9]{0,9}$/);

const Pct = z.number().min(0).max(100);

/** One provider's switch and quota levels (routing-and-policy.md). */
export const ProviderRouting = z
  .object({
    enabled: z.boolean(),
    reservePct: Pct,
    warnPct: Pct,
    pausePct: Pct,
    /** Tasks a day the plan allows; only google-sub counts tasks (M9.5), others keep null. */
    dailyTaskLimit: z.number().int().positive().max(ROUTING_LIMITS.dailyTaskLimit).nullable(),
  })
  .refine((p) => p.warnPct <= p.pausePct, { message: "warnPct must not exceed pausePct" });
export type ProviderRouting = z.infer<typeof ProviderRouting>;

/** A tier's routes, first choice first. */
export const TierRoutes = z.array(Route).min(1).max(ROUTING_LIMITS.routesPerTier);
export type TierRoutes = z.infer<typeof TierRoutes>;

/** A step's tier, or `by_size`: the ticket's tier from its size or pin (`tierFor`). */
export const StepTier = z.union([TierKey, z.literal("by_size")]);
export type StepTier = z.infer<typeof StepTier>;

/**
 * Providers added after routing configs were first stored (AI-260: the API-key Claude provider,
 * pay-per-use, held by spend caps). A stored config without one reads it as this entry: off.
 */
export const LATER_PROVIDERS = {
  "claude-api": { enabled: false, reservePct: 0, warnPct: 70, pausePct: 80, dailyTaskLimit: null },
} as const;

const Providers = z.preprocess(
  (v) => (v && typeof v === "object" && !Array.isArray(v) ? { ...LATER_PROVIDERS, ...v } : v),
  z.record(ProviderKey, ProviderRouting),
);

/** Every field but the scope and the store's stamp: what `put` takes. */
const routingFields = {
  providers: Providers,
  tiers: z.record(TierKey, TierRoutes),
  steps: z.record(RunStep, StepTier),
};

const scopeFields = {
  scope: z.enum(["global", "project"]),
  /** The project's id for `project`, null for `global`. */
  projectId: RoutingProjectId.nullable(),
};

type Scoped = { scope: "global" | "project"; projectId: string | null };
type Limited = { providers: Record<ProviderKey, ProviderRouting> };

const scopeMatches = (c: Scoped) => (c.scope === "project") === (c.projectId !== null);
const tasksOnlyForGoogle = (c: Limited) =>
  ProviderKey.options.every((k) => k === "google-sub" || c.providers[k].dailyTaskLimit === null);

/** A config to store; the store stamps `updatedAt`. */
export const RoutingConfigInput = z
  .object({ ...scopeFields, ...routingFields })
  .refine(scopeMatches, { message: "projectId must be set for project scope and null for global" })
  .refine(tasksOnlyForGoogle, { message: "only google-sub has a daily task limit" });
export type RoutingConfigInput = z.infer<typeof RoutingConfigInput>;

/** A stored config. `updatedAt` null: never stored (the global default). */
export const RoutingConfig = z
  .object({ ...scopeFields, ...routingFields, updatedAt: Timestamp.nullable() })
  .refine(scopeMatches, { message: "projectId must be set for project scope and null for global" })
  .refine(tasksOnlyForGoogle, { message: "only google-sub has a daily task limit" });
export type RoutingConfig = z.infer<typeof RoutingConfig>;

const claude = (model: string) => [{ harness: "claude-code", provider: "claude-sub", model }];

/**
 * Today's routing (`TIER_ROUTES` and `buildRoute` in @andy/domain, ADR-0050): Opus for frontier
 * and strong, Sonnet for fast and cheap; refine on fast, plan, build and sync by size. Only
 * claude-sub is on; its levels match the quota policy (reserve 20%, warn 70%, pause 80%).
 * What `RoutingConfigStore.getGlobal` returns until Andy saves one.
 */
export const DEFAULT_ROUTING: RoutingConfig = RoutingConfig.parse({
  scope: "global",
  projectId: null,
  providers: {
    "claude-sub": {
      enabled: true,
      reservePct: 20,
      warnPct: 70,
      pausePct: 80,
      dailyTaskLimit: null,
    },
    "google-sub": {
      enabled: false,
      reservePct: 20,
      warnPct: 70,
      pausePct: 80,
      dailyTaskLimit: null,
    },
    // Pay-per-use: held by USD caps from M10: Paid models + spend caps, not a reserve.
    openrouter: { enabled: false, reservePct: 0, warnPct: 70, pausePct: 80, dailyTaskLimit: null },
    // claude-api (AI-260): LATER_PROVIDERS, off until Andy enables it.
  },
  tiers: {
    frontier: claude("opus"),
    strong: claude("opus"),
    fast: claude("sonnet"),
    cheap: claude("sonnet"),
  },
  steps: {
    refine: "fast",
    plan: "by_size",
    build: "by_size",
    review: "fast",
    verify: "fast",
    scout: "fast",
    sync: "by_size",
  },
  updatedAt: null,
});

/** The stored document's id: `global`, or `project-<id>`. */
export function routingKey(projectId: string | null): string {
  return projectId === null ? "global" : `project-${projectId}`;
}

/**
 * The stamp for a put: now, but always at least 1 ms after the one it replaces, so a writer
 * holding the old stamp is refused even when two puts land in the same millisecond.
 */
export function nextRoutingStamp(previous: string | null, now: Date): string {
  const floor = previous === null ? 0 : Date.parse(previous) + 1;
  return new Date(Math.max(now.getTime(), floor)).toISOString();
}
