import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { HarnessKey, ProviderKey, ROUTING_LIMITS, type Route, type TierKey } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionCards } from "@/components/ui/option-cards";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { HARNESS_LABELS, PROVIDER_LABELS, TIER_LABELS, modelName } from "@/lib/settings-labels";
import { cn } from "@/lib/utils";

const NEW_ROUTE: Route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" };

/** A skip reason in fewer words for the badge: "provider claude-sub is off" reads "provider off". */
export function shortSkip(reason: string): string {
  return /^provider \S+ is off$/.test(reason) ? "provider off" : reason;
}

/**
 * One tier as a card (AI-376: Models): its plain name and what it is for, then its routes in
 * order. The first usable route says "Runs now"; one that can't run says why ("Skipped: provider
 * off"). A route opens in a sheet to change its harness, provider and model, move it or remove
 * it; "Add a fallback route" adds one at the end and opens it.
 */
export function TierCard({
  tier,
  routes,
  edited,
  saved,
  onChange,
  skipReason,
  refusal,
}: {
  tier: TierKey;
  routes: Route[];
  /** Unsaved changes in this tier. */
  edited: boolean;
  /** The last save changed this tier: its confirmation shows here. */
  saved: boolean;
  onChange: (routes: Route[]) => void;
  skipReason: (route: Route) => string | null;
  refusal: (index: number) => string | undefined;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const label = TIER_LABELS[tier];
  const runs = routes.findIndex((r) => skipReason(r) === null);
  return (
    <section
      aria-label={`Tier ${label.name}`}
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-raised p-3",
        edited ? "border-selected-edge" : "border-border",
      )}
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h3 className="font-medium">{label.name}</h3>
        {edited ? (
          <Badge variant="attention">Edited</Badge>
        ) : saved ? (
          <span role="status" className="text-xs text-muted-foreground">
            Saved
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{label.description}</p>
      {routes.length === 0 && (
        <p className="border-t border-border pt-2 text-xs text-muted-foreground">No routes.</p>
      )}
      <ol className="flex flex-col">
        {routes.map((route, i) => {
          const skipped = skipReason(route);
          const refused = refusal(i);
          const name = `${label.name} route ${i + 1}`;
          return (
            <li key={i} aria-label={name} className="border-t border-border py-2">
              <div className="flex items-start gap-2">
                <span className="w-3 pt-0.5 text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <button
                  type="button"
                  aria-label={`Edit ${name}`}
                  onClick={() => setOpen(i)}
                  className="group flex min-h-11 min-w-0 flex-1 flex-col items-start rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring sm:min-h-0"
                >
                  <span data-model className="flex items-center gap-1 font-medium">
                    {modelName(route.model)}
                    <Pencil
                      aria-hidden
                      className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {HARNESS_LABELS[route.harness].name} · {PROVIDER_LABELS[route.provider].name}
                  </span>
                </button>
                {i === runs ? (
                  <Badge variant="success" className="shrink-0">
                    Runs now
                  </Badge>
                ) : skipped ? (
                  <Badge
                    title={skipped}
                    className={
                      shortSkip(skipped).length <= 20 ? "shrink-0 whitespace-nowrap" : "max-w-[55%]"
                    }
                  >
                    Skipped: {shortSkip(skipped)}
                  </Badge>
                ) : (
                  <Badge className="shrink-0">Fallback</Badge>
                )}
              </div>
              {refused && (
                <p role="alert" className="mt-1 pl-5 text-xs text-destructive">
                  Refused: {refused}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-auto h-11 justify-start self-start px-1 text-muted-foreground sm:h-8"
        disabled={routes.length >= ROUTING_LIMITS.routesPerTier}
        onClick={() => {
          onChange([...routes, NEW_ROUTE]);
          setOpen(routes.length);
        }}
      >
        <Plus aria-hidden className="size-4" />
        Add a fallback route
      </Button>
      <RouteSheet
        tier={tier}
        index={open}
        routes={routes}
        onChange={onChange}
        onIndex={setOpen}
        skipReason={skipReason}
      />
    </section>
  );
}

/** The sheet that edits one route of a tier; changes apply to the draft as they are made. */
function RouteSheet({
  tier,
  index,
  routes,
  onChange,
  onIndex,
  skipReason,
}: {
  tier: TierKey;
  index: number | null;
  routes: Route[];
  onChange: (routes: Route[]) => void;
  onIndex: (index: number | null) => void;
  skipReason: (route: Route) => string | null;
}) {
  const route = index === null ? undefined : routes[index];
  const name = index === null ? "" : `${TIER_LABELS[tier].name} route ${index + 1}`;
  const set = (patch: Partial<Route>) =>
    onChange(routes.map((r, j) => (j === index ? { ...r, ...patch } : r)));
  const move = (by: -1 | 1) => {
    if (index === null) return;
    const next = [...routes];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    onChange(next);
    onIndex(index + by);
  };
  const skipped = route ? skipReason(route) : null;
  return (
    <Sheet open={route !== undefined} onOpenChange={(o) => !o && onIndex(null)}>
      <SheetContent>
        {route && index !== null && (
          <>
            <SheetTitle>{name}</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              {index === 0 ? "Tried first." : `Tried when routes 1 to ${index} can't run.`}{" "}
              {skipped ? null : "Usable now. "}Changes are saved with the bar at the bottom of the
              page.
            </SheetDescription>
            <h4 className="text-xs font-medium text-muted-foreground">Harness</h4>
            <OptionCards
              label={`${name} harness`}
              value={route.harness}
              onValueChange={(harness) => set({ harness: HarnessKey.parse(harness) })}
              className="sm:grid-cols-2"
              options={HarnessKey.options.map((h) => ({
                value: h,
                label: HARNESS_LABELS[h].name,
                description: HARNESS_LABELS[h].description,
              }))}
            />
            <h4 className="text-xs font-medium text-muted-foreground">Provider</h4>
            <OptionCards
              label={`${name} provider`}
              value={route.provider}
              onValueChange={(provider) => set({ provider: ProviderKey.parse(provider) })}
              className="sm:grid-cols-2"
              options={ProviderKey.options.map((p) => ({
                value: p,
                label: PROVIDER_LABELS[p].name,
                description: PROVIDER_LABELS[p].description,
              }))}
            />
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Model
              <Input
                aria-label={`${name} model`}
                className="h-11 text-base text-foreground sm:h-8 sm:text-sm"
                value={route.model}
                onChange={(e) => set({ model: e.target.value })}
              />
              <span className="font-normal">
                The provider&apos;s model id, e.g. opus or sonnet.
              </span>
            </label>
            {skipped && (
              <p className="text-xs">
                <Badge>Skipped</Badge> {skipped}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 sm:h-8"
                aria-label={`Move ${name} up`}
                disabled={index === 0}
                onClick={() => move(-1)}
              >
                <ArrowUp aria-hidden className="size-4" />
                Up
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 sm:h-8"
                aria-label={`Move ${name} down`}
                disabled={index === routes.length - 1}
                onClick={() => move(1)}
              >
                <ArrowDown aria-hidden className="size-4" />
                Down
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 text-destructive sm:h-8"
                aria-label={`Remove ${name}`}
                onClick={() => {
                  onChange(routes.filter((_, j) => j !== index));
                  onIndex(null);
                }}
              >
                <Trash2 aria-hidden className="size-4" />
                Remove
              </Button>
              <Button
                type="button"
                size="sm"
                className="ml-auto h-11 sm:h-8"
                onClick={() => onIndex(null)}
              >
                Done
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
