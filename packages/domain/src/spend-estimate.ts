import type { Model, RunUsage } from "@andy/contracts";

/**
 * Paid-call estimate (AI-236: M10.4, m10-slices.md). Pure: what to reserve in the spend ledger
 * before a paid call or agent task, and what to settle to from its usage. Amounts are integer
 * micro-USD (1 USD = 1,000,000), always rounded up, so an estimate is never below the real cost.
 * Anything unknown returns null: no price, no estimate, so no paid call can be reserved (fail
 * closed). `cost.ts` keeps its API-equivalent estimates for subscription runs.
 */

export const MICRO_USD_PER_USD = 1_000_000;

/** The model fields an estimate reads; cache prices are optional because `Model` has none yet. */
export type PricedModel = Pick<Model, "priceInPerMTokUsd" | "priceOutPerMTokUsd"> & {
  /** Price of a cache read; absent means the input price (never below a real cache read). */
  priceCacheReadPerMTokUsd?: number | null;
  /** Price of a cache write; absent means CACHE_WRITE_FALLBACK × the input price. */
  priceCacheWritePerMTokUsd?: number | null;
};

/**
 * With no cache-write price, a write costs this many times the input price: the highest
 * multiplier in use (Anthropic's 1-hour cache write), so a settled cost is never too low.
 */
export const CACHE_WRITE_FALLBACK = 2;

/** What a reservation covers: one call with known limits, or an agentic task under its cap. */
export type SpendLimits =
  | { kind: "call"; inputTokens: number; maxOutputTokens: number }
  | { kind: "task"; taskCapMicroUsd: number };

const TOKENS_PER_PRICE_UNIT = 1_000_000n; // prices are per million tokens

/**
 * The worst case to reserve, in micro-USD. A call: its input tokens at the input price plus its
 * max output tokens (never a smaller expected count) at the output price. An agentic task: its
 * per-task cap, since its turns and tokens aren't known up front. Null when the model has no
 * input or output price, for both kinds.
 */
export function reserveFor(model: PricedModel, limits: SpendLimits): number | null {
  const input = microUsdPerMTok(model.priceInPerMTokUsd);
  const output = microUsdPerMTok(model.priceOutPerMTokUsd);
  if (input === null || output === null) return null;
  if (limits.kind === "task") return requireCount(limits.taskCapMicroUsd, "taskCapMicroUsd");
  return costMicroUsd([
    [requireCount(limits.inputTokens, "inputTokens"), input],
    [requireCount(limits.maxOutputTokens, "maxOutputTokens"), output],
  ]);
}

/**
 * The actual cost from a run's usage, in micro-USD, cache reads and writes included. Null when
 * usage is missing (the ledger keeps the full reservation) or the model has no price.
 */
export function settleFor(model: PricedModel, usage: RunUsage | null): number | null {
  if (usage === null) return null;
  const input = microUsdPerMTok(model.priceInPerMTokUsd);
  const output = microUsdPerMTok(model.priceOutPerMTokUsd);
  if (input === null || output === null) return null;
  const cacheRead = cachePrice(model.priceCacheReadPerMTokUsd, input);
  const cacheWrite = cachePrice(model.priceCacheWritePerMTokUsd, input * CACHE_WRITE_FALLBACK);
  if (cacheRead === null || cacheWrite === null) return null;
  return costMicroUsd([
    [requireCount(usage.inputTokens, "inputTokens"), input],
    [requireCount(usage.outputTokens, "outputTokens"), output],
    [requireCount(usage.cacheReadTokens, "cacheReadTokens"), cacheRead],
    [requireCount(usage.cacheWriteTokens, "cacheWriteTokens"), cacheWrite],
  ]);
}

/**
 * A USD-per-million-tokens price as integer micro-USD per million tokens. A price finer than one
 * micro-USD rounds up; float noise (0.00391 × 1e6 = 3910.0000000000005) doesn't. Null for a missing,
 * negative or non-finite price.
 */
function microUsdPerMTok(usdPerMTok: number | null | undefined): number | null {
  if (usdPerMTok == null || !Number.isFinite(usdPerMTok) || usdPerMTok < 0) return null;
  const scaled = usdPerMTok * MICRO_USD_PER_USD;
  const nearest = Math.round(scaled);
  const micro = Math.abs(scaled - nearest) < 1e-6 ? nearest : Math.ceil(scaled);
  return Number.isSafeInteger(micro) ? micro : null;
}

/** An explicit cache price, or the fallback when the model has none. A bad explicit price: null. */
function cachePrice(explicit: number | null | undefined, fallback: number): number | null {
  return explicit == null ? fallback : microUsdPerMTok(explicit);
}

/**
 * Sum of tokens × micro-USD per million tokens, divided once and rounded up. BigInt keeps the
 * products exact; a total past Number's safe range can't be reserved, so it is null.
 */
function costMicroUsd(lines: [tokens: number, microPerMTok: number][]): number | null {
  const sum = lines.reduce((acc, [tokens, price]) => acc + BigInt(tokens) * BigInt(price), 0n);
  const total = (sum + TOKENS_PER_PRICE_UNIT - 1n) / TOKENS_PER_PRICE_UNIT;
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

/** Token counts and caps are non-negative safe integers; anything else is a caller bug. */
function requireCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
  return value;
}
