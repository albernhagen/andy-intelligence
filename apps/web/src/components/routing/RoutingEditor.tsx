import { useState } from "react";
import { TierKey, type Route, type RoutingConfig } from "@andy/contracts";
import { effectiveRouting, routeSkipReason } from "@andy/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSaveRouting } from "@/lib/queries";
import { ProviderSettings } from "./ProviderSettings";
import { StepTiers } from "./StepTiers";
import { TierRoutes } from "./TierRoutes";
import { routeKey, routingErrors } from "./routing-errors";

type Fields = Pick<RoutingConfig, "providers" | "tiers" | "steps">;

const fieldsOf = (c: RoutingConfig): Fields =>
  structuredClone({
    providers: c.providers,
    tiers: c.tiers,
    steps: c.steps,
  });

const sameRoute = (a: Route, b: Route) =>
  a.harness === b.harness && a.provider === b.provider && a.model === b.model;

/**
 * The routing editor for global (`projectId` null) or one project (AI-243: M9.8). It edits a
 * draft of `start` and saves it against `ifUpdatedAt`; a refused save keeps the draft and puts
 * each of the API's reasons next to the route it names. Each route shows why the resolver would
 * skip it (AI-238: M9.6), and for a project, a route global doesn't list for that tier.
 */
export function RoutingEditor({
  projectId,
  start,
  ifUpdatedAt,
  global,
}: {
  projectId: string | null;
  start: RoutingConfig;
  ifUpdatedAt: string | null;
  global: RoutingConfig;
}) {
  const [draft, setDraft] = useState<Fields>(() => fieldsOf(start));
  const [reason, setReason] = useState("");
  const save = useSaveRouting(projectId);
  const errors = routingErrors(save.error);

  // The providers a route runs under: the draft's, narrowed to global for a project.
  const providers =
    projectId === null
      ? draft.providers
      : effectiveRouting(global, { ...start, ...draft }).providers;
  const skipReason = (tier: TierKey) => (route: Route) => {
    if (projectId !== null && !global.tiers[tier].some((g) => sameRoute(g, route))) {
      return `not a global ${tier} route`;
    }
    return routeSkipReason(route, providers);
  };

  return (
    <form
      aria-label={projectId === null ? "Global routing" : `Routing for ${projectId}`}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ ...draft, ifUpdatedAt, reason: reason.trim() || undefined });
      }}
    >
      {errors.general.length > 0 && (
        <div role="alert" className="rounded-md bg-destructive/15 p-2 text-sm text-destructive">
          {errors.general.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <ProviderSettings
        providers={draft.providers}
        onChange={(p) => setDraft({ ...draft, providers: p })}
      />
      <section aria-label="Tiers" className="space-y-2">
        <h3 className="text-sm font-medium">Tiers</h3>
        <p className="text-xs text-muted-foreground">
          The first usable route of a tier runs; the rest are skipped with the reason shown.
        </p>
        <div className="grid gap-2 lg:grid-cols-2">
          {TierKey.options.map((tier) => (
            <TierRoutes
              key={tier}
              tier={tier}
              routes={draft.tiers[tier]}
              onChange={(routes) =>
                setDraft({ ...draft, tiers: { ...draft.tiers, [tier]: routes } })
              }
              skipReason={skipReason(tier)}
              refusal={(i) => errors.routes.get(routeKey(tier, i))}
            />
          ))}
        </div>
      </section>
      <StepTiers steps={draft.steps} onChange={(steps) => setDraft({ ...draft, steps })} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Reason for the change"
          placeholder="Why (shown in the change log)"
          className="h-11 max-w-sm text-base sm:h-9 sm:text-sm"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="submit" className="h-11 sm:h-9" disabled={save.isPending}>
          Save routing
        </Button>
        {save.isSuccess && <span className="text-xs text-muted-foreground">Saved.</span>}
      </div>
    </form>
  );
}
