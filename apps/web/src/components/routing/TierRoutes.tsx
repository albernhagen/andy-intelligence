import { ArrowDown, ArrowUp, X } from "lucide-react";
import { HarnessKey, ProviderKey, ROUTING_LIMITS, type Route, type TierKey } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

/** Phone rule (design.md): 44px targets, `text-base` inputs so iOS doesn't zoom. */
const control = "h-11 text-base sm:h-8 sm:text-sm";

const NEW_ROUTE: Route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" };

/**
 * One tier's routes in order, first choice first (AI-243: M9.8): change, reorder, remove, add.
 * Each route shows why it would be skipped (`skipReason`) and, after a refused save, the API's
 * reason (`refusal`), next to it.
 */
export function TierRoutes({
  tier,
  routes,
  onChange,
  skipReason,
  refusal,
}: {
  tier: TierKey;
  routes: Route[];
  onChange: (routes: Route[]) => void;
  skipReason: (route: Route) => string | null;
  refusal: (index: number) => string | undefined;
}) {
  const set = (i: number, route: Route) => onChange(routes.map((r, j) => (j === i ? route : r)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...routes];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    onChange(next);
  };
  return (
    <section aria-label={`Tier ${tier}`} className="space-y-2 rounded-md border border-border p-2">
      <h4 className="text-sm font-medium">{tier}</h4>
      {routes.length === 0 && <p className="text-xs text-muted-foreground">No routes.</p>}
      <ol className="space-y-2">
        {routes.map((route, i) => {
          const skipped = skipReason(route);
          const refused = refusal(i);
          const name = `${tier} route ${i + 1}`;
          return (
            <li key={i} aria-label={name} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-4 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <Select
                  aria-label={`${name} harness`}
                  className={`${control} w-auto`}
                  value={route.harness}
                  onChange={(e) => set(i, { ...route, harness: HarnessKey.parse(e.target.value) })}
                >
                  {HarnessKey.options.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </Select>
                <Select
                  aria-label={`${name} provider`}
                  className={`${control} w-auto`}
                  value={route.provider}
                  onChange={(e) =>
                    set(i, { ...route, provider: ProviderKey.parse(e.target.value) })
                  }
                >
                  {ProviderKey.options.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
                <Input
                  aria-label={`${name} model`}
                  className={`${control} w-32`}
                  value={route.model}
                  onChange={(e) => set(i, { ...route, model: e.target.value })}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="size-11 px-0 sm:size-8"
                  aria-label={`Move ${name} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp aria-hidden className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="size-11 px-0 sm:size-8"
                  aria-label={`Move ${name} down`}
                  disabled={i === routes.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown aria-hidden className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="size-11 px-0 sm:size-8"
                  aria-label={`Remove ${name}`}
                  onClick={() => onChange(routes.filter((_, j) => j !== i))}
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </div>
              {skipped && (
                <p className="pl-6 text-xs">
                  <Badge variant="attention">Skipped</Badge> {skipped}
                </p>
              )}
              {refused && (
                <p role="alert" className="pl-6 text-xs">
                  <Badge variant="danger">Refused</Badge> {refused}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-11 sm:h-8"
        disabled={routes.length >= ROUTING_LIMITS.routesPerTier}
        onClick={() => onChange([...routes, NEW_ROUTE])}
      >
        Add route
      </Button>
    </section>
  );
}
