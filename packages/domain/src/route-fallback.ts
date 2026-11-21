import type {
  ProviderKey,
  ProviderRouting,
  QuotaLevel,
  QuotaReading,
  QuotaWindow,
  Route,
} from "@andy/contracts";
import { quotaStatus, readingsForDispatch, type QuotaThresholds } from "./quota";
import type { EffectiveRouting, RouteCandidate, SkippedRoute } from "./route-resolver";
import { PROVIDER_BILLING } from "./runs";

/**
 * Quota-aware route fallback (AI-261: M10.14, routing-and-policy.md). Pure: dispatch reads the
 * quota readings and the spend gate, and this walks the resolver's routes in order with them:
 *
 * - A subscription route whose provider has a fresh reading at or past its pause level is
 *   skipped, so the reserve (20% by default) stays for Andy.
 * - A pay_per_use route the spend gate would refuse (a cap, no price, no ledger) is skipped,
 *   never started.
 * - A subscription route with a stale or missing reading is `unknown`: a later usable route is
 *   preferred. With none, the first unknown one runs (ADR-0079: unknown doesn't stop dispatch),
 *   unless a route before it was skipped at its pause level: past a reserve that is known to be
 *   reached, an unread one fails closed.
 *
 * Every route not taken is returned with its reason, for the run (`Run.routeSkips`).
 */

/** Why dispatch idles when no route is left (ADR-0079, AI-248). */
export type FallbackIdle = "quota_reserve" | "spend_cap";

/** What dispatch knows about one route that the resolver found usable. */
export type RouteAvailability =
  | { kind: "ok" }
  | { kind: "unknown"; reason: string }
  | { kind: "skip"; reason: string; idle: FallbackIdle };

export type FallbackResult =
  | { route: Route; skipped: SkippedRoute[] }
  /** `idle` null: every route was unusable for a routing reason (provider off, can't run). */
  | { route: null; skipped: SkippedRoute[]; idle: FallbackIdle | null };

/** Each subscription's quota windows (ARCHITECTURE §5; google-sub counts tasks, AI-232: M9.5). */
export const QUOTA_WINDOWS: Record<ProviderKey, QuotaWindow[]> = {
  "claude-sub": ["5h", "weekly"],
  "google-sub": ["daily_tasks"],
  openrouter: [],
  // AI-260: pay-per-use on an API key: held by the spend caps, no subscription windows.
  "claude-api": [],
};

/**
 * Walks `candidates` (from `routeCandidates`) in order and returns the first route that may run
 * now. `availability` is asked only for routes the resolver found usable, one at a time, and not
 * past the route taken (each paid check reads the spend ledger).
 */
export async function chooseRoute(
  candidates: RouteCandidate[],
  availability: (route: Route) => Promise<RouteAvailability>,
): Promise<FallbackResult> {
  const tried: (SkippedRoute & { unknown?: true; idle?: FallbackIdle })[] = [];
  for (const { route, problem } of candidates) {
    if (problem !== null) {
      tried.push({ route, reason: problem });
      continue;
    }
    const a = await availability(route);
    if (a.kind === "ok") {
      return {
        route,
        skipped: tried
          .map((t) =>
            t.unknown ? { route: t.route, reason: `${t.reason}; preferred a route with room` } : t,
          )
          .map(plain),
      };
    }
    if (a.kind === "unknown") tried.push({ route, reason: a.reason, unknown: true });
    else tried.push({ route, reason: a.reason, idle: a.idle });
  }
  const firstIdle = tried.find((t) => t.idle)?.idle ?? null;
  const unknown = tried.find((t) => t.unknown);
  const pastReserve = tried.some((t) => t.idle === "quota_reserve");
  if (unknown && !pastReserve) {
    return { route: unknown.route, skipped: tried.filter((t) => t !== unknown).map(plain) };
  }
  const skipped = tried.map((t) =>
    t.unknown
      ? { route: t.route, reason: `${t.reason}; not used past a reserve already reached` }
      : t,
  );
  // An unknown route held back past a reserve idles like the reserve it sits behind.
  return { route: null, skipped: skipped.map(plain), idle: firstIdle };
}

const plain = (s: SkippedRoute): SkippedRoute => ({ route: s.route, reason: s.reason });

/**
 * A subscription's level for dispatch: its fresh readings (the last 6 hours, ADR-0079) against
 * its warn and pause levels in the project's routing. A window with no fresh reading makes it
 * `unknown` unless another is at warn or pause, as in `quotaStatus`: never assume headroom
 * (routing-and-policy.md).
 */
export function subscriptionLevel(
  provider: ProviderKey,
  readings: QuotaReading[],
  routing: ProviderRouting,
  now: Date,
): QuotaLevel {
  const thresholds = { warnPct: routing.warnPct, pausePct: routing.pausePct };
  return quotaStatus(
    provider,
    readingsForDispatch(readings, now),
    now,
    thresholds,
    QUOTA_WINDOWS[provider],
  ).level;
}

/**
 * What dispatch knows about a route: a subscription by its provider's level (`levels`; absent
 * is unknown), a pay_per_use route by the spend gate's preview (`spendRefusal`: null when it
 * would allow the task, else why not).
 */
export function routeAvailability(
  levels: Partial<Record<ProviderKey, QuotaLevel>>,
  providers: Record<ProviderKey, ProviderRouting>,
  spendRefusal: (route: Route) => Promise<string | null>,
): (route: Route) => Promise<RouteAvailability> {
  return async (route) => {
    const provider = route.provider;
    if (PROVIDER_BILLING[provider] === "pay_per_use") {
      const refusal = await spendRefusal(route);
      return refusal === null
        ? { kind: "ok" }
        : { kind: "skip", reason: refusal, idle: "spend_cap" };
    }
    const level = levels[provider] ?? "unknown";
    if (level === "pause") {
      const pausePct = providers[provider].pausePct;
      return {
        kind: "skip",
        reason: `${provider} quota is at its pause level (${pausePct}% used), keeping the reserve`,
        idle: "quota_reserve",
      };
    }
    if (level === "unknown") {
      return { kind: "unknown", reason: `${provider} quota reading is stale or missing` };
    }
    return { kind: "ok" };
  };
}

const SEVERITY: QuotaLevel[] = ["pause", "warn", "unknown", "ok"];

/**
 * The quota level the dispatch caps act on (`mayDispatch`), across the providers on in the
 * project's routing. `pause` only when some provider is at its pause level and no other has a
 * reading with room (so the fallback above has nowhere to go); else the worst level of the
 * rest, so `warn` keeps its one-task cap. A pay_per_use provider counts as `ok` here: the spend
 * gate decides per task. With only claude-sub on (the default), this is claude-sub's level, as
 * before.
 */
export function dispatchQuotaLevel(
  levels: Partial<Record<ProviderKey, QuotaLevel>>,
  providers: Record<ProviderKey, ProviderRouting>,
): QuotaLevel {
  const on = (Object.keys(providers) as ProviderKey[])
    .filter((p) => providers[p].enabled)
    .map((p): QuotaLevel =>
      PROVIDER_BILLING[p] === "pay_per_use" ? "ok" : (levels[p] ?? "unknown"),
    );
  if (on.length === 0) return "unknown";
  const withRoom = on.filter((l) => l === "ok" || l === "warn");
  if (on.includes("pause") && withRoom.length === 0) return "pause";
  const rest: QuotaLevel[] = on.filter((l) => l !== "pause");
  return SEVERITY.find((l) => rest.includes(l)) ?? "unknown";
}

/**
 * The lowest warn and pause levels `provider` has in any of `routings` (global and each
 * project's): the readings at that pause level hold at least one project at its reserve, so
 * clearing a quota idle (AI-74) discards them all. With none, the §5 defaults.
 */
export function lowestThresholds(
  provider: ProviderKey,
  routings: Pick<EffectiveRouting, "providers">[],
  fallback: QuotaThresholds,
): QuotaThresholds {
  if (routings.length === 0) return fallback;
  return {
    warnPct: Math.min(...routings.map((r) => r.providers[provider].warnPct)),
    pausePct: Math.min(...routings.map((r) => r.providers[provider].pausePct)),
  };
}
