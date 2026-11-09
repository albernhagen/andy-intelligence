import {
  ACTIVE_RUN_STATUSES,
  type BillingType,
  type QuotaDelta,
  type QuotaReading,
  type Run,
  type RunUsage,
  type TicketCost,
} from "@andy/contracts";
import { quotaFreshness } from "./quota";

/**
 * Cost per run, totalled per ticket (AI-67, ADR-0060). The subscription itself is flat-rate:
 * an estimate is what the run would have cost at API prices, not money spent.
 */

export const COST_RATES_AS_OF = "2026-10-06";

interface Rate {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
  /** The 5-minute cache write price: 1.25 × input. */
  cacheWriteUsdPerMTok: number;
}

const OPUS: Rate = {
  inputUsdPerMTok: 4,
  outputUsdPerMTok: 20,
  cacheReadUsdPerMTok: 0.2,
  cacheWriteUsdPerMTok: 5,
};
const SONNET: Rate = {
  inputUsdPerMTok: 2,
  outputUsdPerMTok: 10,
  cacheReadUsdPerMTok: 0.2,
  cacheWriteUsdPerMTok: 2.5,
};
const HAIKU: Rate = {
  inputUsdPerMTok: 0.1,
  outputUsdPerMTok: 0.5,
  cacheReadUsdPerMTok: 0.01,
  cacheWriteUsdPerMTok: 0.125,
};
const FABLE: Rate = {
  inputUsdPerMTok: 10,
  outputUsdPerMTok: 50,
  cacheReadUsdPerMTok: 0.25,
  cacheWriteUsdPerMTok: 12.5,
};

/** API list prices as of COST_RATES_AS_OF. Aliases are what a Route's model may hold. */
export const COST_RATES: Readonly<Record<string, Rate>> = {
  opus: OPUS,
  "claude-opus-5-5": OPUS,
  sonnet: SONNET,
  "claude-sonnet-5-5": SONNET,
  haiku: HAIKU,
  "claude-haiku-5-5": HAIKU,
  fable: FABLE,
  "claude-fable-5-1": FABLE,
};

const USD_DECIMALS = 1_000_000;
const roundUsd = (usd: number) => Math.round(usd * USD_DECIMALS) / USD_DECIMALS;
const roundPct = (pct: number) => Math.round(pct * 10) / 10;

/** What the usage would cost at API prices; null for a model not in the table. */
export function estimateCostUsd(model: string, usage: RunUsage): number | null {
  const rate = Object.hasOwn(COST_RATES, model) ? COST_RATES[model] : undefined;
  if (!rate) return null;
  const perMillion =
    usage.inputTokens * rate.inputUsdPerMTok +
    usage.outputTokens * rate.outputUsdPerMTok +
    usage.cacheReadTokens * rate.cacheReadUsdPerMTok +
    usage.cacheWriteTokens * rate.cacheWriteUsdPerMTok;
  return roundUsd(perMillion / 1_000_000);
}

/**
 * The cost to store on a run. Pay-per-use: the reported amount is real money. Otherwise the rate
 * table, falling back to the harness's own API-equivalent figure for a model not in the table.
 * No usage on a subscription run means unknown, even if a figure came with it.
 */
export function runCost(
  model: string,
  billing: BillingType,
  usage: RunUsage | null,
  reportedUsd: number | null,
): { costUsd: number | null; costIsEstimate: boolean } {
  if (billing === "pay_per_use" && reportedUsd !== null) {
    return { costUsd: reportedUsd, costIsEstimate: false };
  }
  if (!usage) return { costUsd: null, costIsEstimate: billing === "subscription" };
  return { costUsd: estimateCostUsd(model, usage) ?? reportedUsd, costIsEstimate: true };
}

function windowDelta(
  window: "5h" | "weekly",
  before: QuotaReading[],
  after: QuotaReading[],
): number | null {
  const was = before.find((r) => r.window === window);
  const now = after.find((r) => r.window === window);
  if (!was || !now) return null;
  // A window that reset between the readings can't be compared; neither can a drop in usage.
  if (quotaFreshness(was, new Date(now.takenAt)) !== "fresh" || now.usedPct < was.usedPct) {
    return null;
  }
  return roundPct(now.usedPct - was.usedPct);
}

/**
 * Quota used since the last stored reading, per window; null when no window can be compared.
 * Each run is measured from the reading before it, so runs on other projects can blur which run
 * used what, but the sum across runs never counts the same usage twice.
 */
export function quotaDelta(before: QuotaReading[], after: QuotaReading[]): QuotaDelta | null {
  const delta = {
    "5h": windowDelta("5h", before, after),
    weekly: windowDelta("weekly", before, after),
  };
  return delta["5h"] === null && delta.weekly === null ? null : delta;
}

const addPct = (total: number | null, delta: number | null | undefined) =>
  delta === null || delta === undefined ? total : roundPct((total ?? 0) + delta);

/** Totals over the ticket's finished runs; a run with no cost counts as unknown, not as $0. */
export function ticketCost(runs: readonly Run[]): TicketCost {
  const done = runs.filter((r) => !ACTIVE_RUN_STATUSES.includes(r.status));
  let usd = 0;
  let fiveHour: number | null = null;
  let weekly: number | null = null;
  for (const run of done) {
    usd += run.costUsd ?? 0;
    fiveHour = addPct(fiveHour, run.quotaDelta?.["5h"]);
    weekly = addPct(weekly, run.quotaDelta?.weekly);
  }
  return {
    estimatedCostUsd: roundUsd(usd),
    quotaDelta: { "5h": fiveHour, weekly },
    completedRuns: done.length,
    unknownRuns: done.filter((r) => r.costUsd === null).length,
  };
}
