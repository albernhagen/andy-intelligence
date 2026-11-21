import {
  MODEL_SCOUT_LIMITS,
  ModelList,
  ModelListEntry,
  type ListedModel,
  type Model,
  type ModelOutcome,
  type Route,
  type ScoutProposal,
  type ScoutTierChange,
  type Tier,
} from "@andy/contracts";

/**
 * The model scout's proposal (AI-237: M10.5, skills-and-scout.md §7.4): pure, no network, no
 * schedule (M10.17 runs it weekly). It reads the `openrouter` provider's public models list, the
 * current tiers and recent outcomes per model, and proposes a tier change only when one is
 * warranted. It never writes a tier: the proposal becomes a pending ConfigChange Andy accepts.
 *
 * Only a tier's first route is scouted, and only when it is on the `openrouter` provider: the
 * list prices that provider's models, not the subscriptions'. Per tier, in order:
 * - **gone:** its model isn't listed. Propose the cheapest listed model that qualifies (below),
 *   or flag the tier (`to: null`) when none does.
 * - **cheaper:** a listed model qualifies and costs less (blended price, below) than the current
 *   one. The cheapest qualifying model is proposed.
 * - **price_change:** the model is listed at a price more than `PRICE_CHANGE_SHARE` off the one
 *   recorded for it (`knownModels`): propose the same route with the new price.
 *
 * A candidate qualifies when its outcomes have at least `MIN_OUTCOME_TASKS` tasks and a success
 * rate at least the current model's (which needs as many tasks too), and its context is not
 * smaller than the current model's, and it isn't a free variant. A tier whose model is listed but
 * skipped (unpriced), or missing from a list cut at the cap, comes back unchecked, never gone. Without enough outcomes on both sides nothing is proposed:
 * price alone never swaps a model.
 */

/** Finished agent tasks a model needs before its success rate is compared. */
export const MIN_OUTCOME_TASKS = 5;
/** A listed price this far off the recorded one (either way) is a price change. */
export const PRICE_CHANGE_SHARE = 0.1;
/** Agent tasks read far more than they write: the blended price weights input 3 to 1. */
const INPUT_WEIGHT = 0.75;

export type ParsedModelList =
  | {
      ok: true;
      models: ListedModel[];
      skipped: number;
      /** Ids of skipped items that had a string id (clipped): listed, but not usable. */
      skippedIds: ReadonlySet<string>;
      truncated: boolean;
    }
  | { ok: false; error: string };

/**
 * The listed models, normalized to USD per million tokens. A list without a `data` array fails;
 * malformed items (bad id, price missing, negative or variable) are skipped and counted; at most
 * `MODEL_SCOUT_LIMITS.maxModels` items are read.
 */
export function parseModelList(raw: unknown): ParsedModelList {
  const envelope = ModelList.safeParse(raw);
  if (!envelope.success) {
    const issue = envelope.error.issues[0];
    return {
      ok: false,
      error: `models list: ${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`,
    };
  }
  const items = envelope.data.data.slice(0, MODEL_SCOUT_LIMITS.maxModels);
  const models: ListedModel[] = [];
  let skipped = 0;
  const skippedIds = new Set<string>();
  for (const item of items) {
    const parsed = ModelListEntry.safeParse(item);
    if (!parsed.success) {
      skipped += 1;
      const id = (item as { id?: unknown } | null)?.id;
      if (typeof id === "string") skippedIds.add(id.slice(0, MODEL_SCOUT_LIMITS.id));
      continue;
    }
    const m = parsed.data;
    models.push({
      id: m.id,
      name: m.name,
      contextTokens: m.context_length ?? null,
      priceInPerMTokUsd: perMTok(m.pricing.prompt),
      priceOutPerMTokUsd: perMTok(m.pricing.completion),
    });
  }
  return {
    ok: true,
    models,
    skipped,
    skippedIds,
    truncated: envelope.data.data.length > MODEL_SCOUT_LIMITS.maxModels,
  };
}

const perMTok = (perToken: number) => Math.round(perToken * 1e6 * 1e4) / 1e4;
const blended = (m: { priceInPerMTokUsd: number; priceOutPerMTokUsd: number }) =>
  INPUT_WEIGHT * m.priceInPerMTokUsd + (1 - INPUT_WEIGHT) * m.priceOutPerMTokUsd;
const usd = (n: number) => `$${n.toFixed(2)}`;
/**
 * Free variants (`:free`, or both prices 0) are never candidates: they are rate-limited and can be
 * withdrawn, so a tier can't depend on them.
 */
const isFree = (m: ListedModel) =>
  m.id.endsWith(":free") || (m.priceInPerMTokUsd === 0 && m.priceOutPerMTokUsd === 0);

/** A tier the scout couldn't judge: its model is listed but unusable, or the list was cut. */
export interface UncheckedTier {
  tier: Tier["key"];
  model: string;
  reason: "unpriced" | "list_truncated";
}

export type ScoutResult =
  | {
      ok: true;
      proposal: ScoutProposal | null;
      skipped: number;
      /** The list had more than `MODEL_SCOUT_LIMITS.maxModels` items; the rest weren't read. */
      truncated: boolean;
      unchecked: UncheckedTier[];
    }
  | { ok: false; error: string };

/**
 * The scout's proposal for `currentTiers`, or null when nothing would change. A list that fails
 * to parse proposes nothing and returns the parse error.
 */
export function scoutProposal(
  listedModels: unknown,
  currentTiers: readonly Tier[],
  outcomesByModel: ReadonlyMap<string, ModelOutcome>,
  knownModels: readonly Pick<Model, "id" | "priceInPerMTokUsd" | "priceOutPerMTokUsd">[] = [],
): ScoutResult {
  const list = parseModelList(listedModels);
  if (!list.ok) return list;
  const byId = new Map(list.models.map((m) => [m.id, m]));
  const known = new Map(knownModels.map((m) => [m.id, m]));

  const changes: ScoutTierChange[] = [];
  const unchecked: UncheckedTier[] = [];
  for (const tier of currentTiers) {
    const route = tier.routes[0];
    if (!route || route.provider !== "openrouter") continue;
    // Not usable isn't gone: a skipped item is listed, and a cut list may hold the model further on.
    if (!byId.has(route.model) && (list.skippedIds.has(route.model) || list.truncated)) {
      const reason = list.skippedIds.has(route.model) ? "unpriced" : "list_truncated";
      unchecked.push({ tier: tier.key, model: route.model, reason });
      continue;
    }
    const change = tierChange(tier, route, byId, list.models, outcomesByModel, known);
    if (change) changes.push(change);
  }
  const base = { ok: true as const, skipped: list.skipped, truncated: list.truncated, unchecked };
  return { ...base, proposal: changes.length === 0 ? null : toProposal(changes) };
}

function tierChange(
  tier: Tier,
  route: Route,
  byId: ReadonlyMap<string, ListedModel>,
  listed: readonly ListedModel[],
  outcomes: ReadonlyMap<string, ModelOutcome>,
  known: ReadonlyMap<string, Pick<Model, "priceInPerMTokUsd" | "priceOutPerMTokUsd">>,
): ScoutTierChange | null {
  const current = byId.get(route.model);
  const base = outcomes.get(route.model);
  const enough = (o: ModelOutcome | undefined): o is ModelOutcome =>
    !!o && o.tasks >= MIN_OUTCOME_TASKS;
  const qualifies = (m: ListedModel) => {
    const o = outcomes.get(m.id);
    if (m.id === route.model || isFree(m) || !enough(o) || !enough(base)) return false;
    if (o.successRate < base.successRate) return false;
    const minContext = current?.contextTokens ?? null;
    return minContext === null || (m.contextTokens ?? 0) >= minContext;
  };
  const cheapest = (pool: ListedModel[]) =>
    pool.sort((a, b) => blended(a) - blended(b) || a.id.localeCompare(b.id))[0];
  const to = (m: ListedModel): Route => ({ ...route, model: m.id });

  if (!current) {
    const pick = cheapest(listed.filter(qualifies));
    return {
      tier: tier.key,
      kind: "gone",
      from: route,
      to: pick ? to(pick) : null,
      prices: null,
      rationale: pick
        ? `${route.model} is no longer listed. ${pick.id} succeeded on ${pct(outcomes.get(pick.id)!)} of ${outcomes.get(pick.id)!.tasks} tasks (current: ${pct(base!)}) at ${usd(blended(pick))}/M tokens blended.`
        : `${route.model} is no longer listed and no listed model has enough outcomes to replace it: pick one by hand.`,
    };
  }

  const pick = cheapest(listed.filter((m) => qualifies(m) && blended(m) < blended(current)));
  if (pick) {
    const o = outcomes.get(pick.id)!;
    return {
      tier: tier.key,
      kind: "cheaper",
      from: route,
      to: to(pick),
      prices: null,
      rationale: `${pick.id} costs ${usd(blended(pick))}/M tokens blended against ${usd(blended(current))} for ${route.model}, and succeeded on ${pct(o)} of ${o.tasks} tasks (current: ${pct(base!)} of ${base!.tasks}).`,
    };
  }

  const was = known.get(route.model);
  if (was && was.priceInPerMTokUsd !== null && was.priceOutPerMTokUsd !== null) {
    const old = blended({
      priceInPerMTokUsd: was.priceInPerMTokUsd,
      priceOutPerMTokUsd: was.priceOutPerMTokUsd,
    });
    const now = blended(current);
    if (old > 0 ? Math.abs(now - old) / old > PRICE_CHANGE_SHARE : now > 0) {
      return {
        tier: tier.key,
        kind: "price_change",
        from: route,
        to: route,
        prices: {
          inPerMTokUsd: current.priceInPerMTokUsd,
          outPerMTokUsd: current.priceOutPerMTokUsd,
        },
        rationale: `${route.model} now costs ${usd(now)}/M tokens blended (was ${usd(old)}).`,
      };
    }
  }
  return null;
}

const pct = (o: ModelOutcome) => `${Math.round(o.successRate * 100)}%`;

function toProposal(changes: ScoutTierChange[]): ScoutProposal {
  const diff: Record<string, unknown> = {};
  for (const c of changes) {
    diff[c.tier] = { kind: c.kind, from: c.from.model, to: c.to?.model ?? null, prices: c.prices };
  }
  return {
    entity: "tiers",
    entityId: "global",
    changes,
    diff,
    reason: changes
      .map((c) => `${c.tier}: ${c.rationale}`)
      .join("\n")
      .slice(0, 2000),
  };
}
