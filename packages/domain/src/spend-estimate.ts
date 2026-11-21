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

/**
 * Prices are kept as integer pico-USD per million tokens (1 USD = 10^12): a price is exact to
 * 12 decimals, and anything finer rounds up. Tokens × that price is pico-USD × 10^6, so the
 * total is divided by 10^12 to get micro-USD.
 */
const PICO_PER_MICRO_TIMES_MTOK = 1_000_000_000_000n;
const PRICE_DECIMALS = 12;

/**
 * The worst case to reserve, in micro-USD. A call: its input tokens at the input price plus its
 * max output tokens (never a smaller expected count) at the output price. An agentic task: its
 * per-task cap, since its turns and tokens aren't known up front. Null when the model has no
 * input or output price, for both kinds. Bad limits are a caller bug and throw.
 */
export function reserveFor(model: PricedModel, limits: SpendLimits): number | null {
  const input = picoUsdPerMTok(model.priceInPerMTokUsd);
  const output = picoUsdPerMTok(model.priceOutPerMTokUsd);
  if (input === null || output === null) return null;
  if (limits.kind === "task") return requireCount(limits.taskCapMicroUsd, "taskCapMicroUsd");
  return costMicroUsd([
    [requireCount(limits.inputTokens, "inputTokens"), input],
    [requireCount(limits.maxOutputTokens, "maxOutputTokens"), output],
  ]);
}

/**
 * The actual cost from a run's usage, in micro-USD, cache reads and writes included. Null when
 * usage is missing or malformed (the ledger keeps the full reservation) or the model has no price.
 */
export function settleFor(model: PricedModel, usage: RunUsage | null): number | null {
  if (usage === null) return null;
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage;
  if (![inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens].every(isCount)) return null;
  const input = picoUsdPerMTok(model.priceInPerMTokUsd);
  const output = picoUsdPerMTok(model.priceOutPerMTokUsd);
  if (input === null || output === null) return null;
  const cacheRead = cachePrice(model.priceCacheReadPerMTokUsd, input);
  const cacheWrite = cachePrice(
    model.priceCacheWritePerMTokUsd,
    input * BigInt(CACHE_WRITE_FALLBACK),
  );
  if (cacheRead === null || cacheWrite === null) return null;
  return costMicroUsd([
    [inputTokens, input],
    [outputTokens, output],
    [cacheReadTokens, cacheRead],
    [cacheWriteTokens, cacheWrite],
  ]);
}

/**
 * A USD-per-million-tokens price as integer pico-USD per million tokens, with no float
 * arithmetic: the number's own decimal form (`String(0.00391)` is "0.00391", `String(1e-13)` is
 * "1e-13") is read digit by digit, and any digit past the 12th decimal rounds up, so a non-zero
 * price is never 0. Null for a missing, negative or non-finite price.
 */
function picoUsdPerMTok(usdPerMTok: number | null | undefined): bigint | null {
  if (usdPerMTok == null || !Number.isFinite(usdPerMTok) || usdPerMTok < 0) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(usdPerMTok));
  if (!match) return null;
  const [, whole = "", fraction = "", exponent = "0"] = match;
  // value = digits × 10^shift, where shift counts the fraction digits and the exponent.
  const digits = BigInt(whole + fraction);
  const shift = Number(exponent) - fraction.length + PRICE_DECIMALS;
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  return ceilDiv(digits, 10n ** BigInt(-shift));
}

/** An explicit cache price, or the fallback when the model has none. A bad explicit price: null. */
function cachePrice(explicit: number | null | undefined, fallback: bigint): bigint | null {
  return explicit == null ? fallback : picoUsdPerMTok(explicit);
}

/**
 * Sum of tokens × price, divided once and rounded up to micro-USD. A total past Number's safe
 * range can't be reserved, so it is null.
 */
function costMicroUsd(lines: [tokens: number, picoPerMTok: bigint][]): number | null {
  const sum = lines.reduce((acc, [tokens, price]) => acc + BigInt(tokens) * price, 0n);
  const total = ceilDiv(sum, PICO_PER_MICRO_TIMES_MTOK);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Token counts and caps for a reserve are non-negative safe integers; else a caller bug. */
function requireCount(value: number, name: string): number {
  if (!isCount(value)) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
  return value;
}
