import { TierKey } from "@andy/contracts";
import { ApiError } from "@/lib/api";

/**
 * Where the API's refusal of a routing save points (AI-243: M9.8). The routing API names a route
 * as `tier <tier>, route <n>: <reason>` (AI-239: M9.7); those lines go next to that route, the
 * rest (a provider wider than global, a stale save) above the editor.
 */
export interface RoutingErrors {
  /** `${tier}:${index}` (0-based) → the API's reason for that route. */
  routes: Map<string, string>;
  /** Everything else: the error and any detail not about one route. */
  general: string[];
}

const ROUTE_LINE = /^tier ([a-z]+), route (\d+): (.+)$/;

export const routeKey = (tier: TierKey, index: number) => `${tier}:${index}`;

export function routingErrors(error: unknown): RoutingErrors {
  const routes = new Map<string, string>();
  if (!error) return { routes, general: [] };
  if (!(error instanceof ApiError)) return { routes, general: [String(error)] };
  const general: string[] = [];
  for (const line of error.details) {
    const m = ROUTE_LINE.exec(line);
    const tier = m && TierKey.safeParse(m[1]);
    if (m && tier?.success) routes.set(routeKey(tier.data, Number(m[2]) - 1), m[3]!);
    else general.push(line);
  }
  // The message alone says what kind of refusal it was; keep it unless every line is placed.
  if (general.length > 0 || routes.size === 0) general.unshift(error.message);
  return { routes, general };
}
