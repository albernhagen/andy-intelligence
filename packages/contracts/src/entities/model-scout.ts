import { z } from "zod";
import { Route, TierKey } from "./common";

/**
 * The model scout's inputs and output (AI-237: M10.5, skills-and-scout.md §7.4). The models list
 * is a provider's public models listing (today the `openrouter` provider's `/models` response):
 * third-party data, parsed defensively.
 * Model names, ids and prices in it are data, never instructions. A proposal changes nothing by
 * itself: it becomes a pending ConfigChange that Andy accepts.
 */

/** Caps (ADR-0028): a list longer than this is cut, and ids and names are clipped. */
export const MODEL_SCOUT_LIMITS = { maxModels: 2000, id: 100, name: 120 } as const;

/** Listed model ids look like `vendor/model-name:variant`; anything else is skipped. */
const ModelId = z
  .string()
  .max(MODEL_SCOUT_LIMITS.id)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);

/** Prices come as decimal strings in USD per token, e.g. "0.000003"; numbers are accepted too. */
const PerTokenUsd = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : v.trim() === "" ? NaN : Number(v);
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: "custom", message: "price is not a non-negative number" });
    return z.NEVER;
  }
  return n;
});

/** One listed model; unknown fields are dropped. */
export const ModelListEntry = z.object({
  id: ModelId,
  name: z
    .string()
    .optional()
    .transform((n) => (n ?? "").slice(0, MODEL_SCOUT_LIMITS.name)),
  context_length: z.number().int().positive().nullable().optional(),
  pricing: z.object({ prompt: PerTokenUsd, completion: PerTokenUsd }),
});
export type ModelListEntry = z.infer<typeof ModelListEntry>;

/** The list's envelope only; each item is parsed on its own so one bad item can't sink the list. */
export const ModelList = z.object({ data: z.array(z.unknown()) });

/** A listed model, normalized: prices in USD per million tokens. */
export interface ListedModel {
  id: string;
  name: string;
  contextTokens: number | null;
  priceInPerMTokUsd: number;
  priceOutPerMTokUsd: number;
}

/** How a model did on recent agent tasks of a tier (read from Run outcomes). */
export const ModelOutcome = z.object({
  /** Finished agent tasks counted. */
  tasks: z.number().int().nonnegative(),
  /** Share of them that succeeded (0 to 1). */
  successRate: z.number().min(0).max(1),
});
export type ModelOutcome = z.infer<typeof ModelOutcome>;

/** Why a tier's route would change. */
export const ScoutChangeKind = z.enum(["cheaper", "price_change", "gone"]);
export type ScoutChangeKind = z.infer<typeof ScoutChangeKind>;

export const ScoutTierChange = z.object({
  tier: TierKey,
  kind: ScoutChangeKind,
  from: Route,
  /** The proposed route; null when the model is gone and nothing qualifies (the tier is flagged). */
  to: Route.nullable(),
  /** New prices for `price_change`, USD per million tokens. */
  prices: z.object({ inPerMTokUsd: z.number(), outPerMTokUsd: z.number() }).nullable(),
  rationale: z.string().max(500),
});
export type ScoutTierChange = z.infer<typeof ScoutTierChange>;

/**
 * A proposal in the shape of a pending ConfigChange (entity, entity id, diff, reason): the
 * scheduled job (M10.17) stores it as one, for Andy to accept or reject.
 */
export const ScoutProposal = z.object({
  entity: z.literal("tiers"),
  entityId: z.literal("global"),
  changes: z.array(ScoutTierChange).min(1),
  diff: z.record(z.string(), z.unknown()),
  reason: z.string().max(2000),
});
export type ScoutProposal = z.infer<typeof ScoutProposal>;
