import { useState } from "react";
import { ProviderKey, TierKey, type Route, type RoutingConfig } from "@andy/contracts";
import { effectiveRouting, routeSkipReason } from "@andy/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SavedCue } from "@/components/SavedCue";
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

/** Which part a save was for, so its "Saved" cue and refusal sit there. */
type Part = "providers" | "steps" | TierKey;

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The routing editor for global (`projectId` null) or one project (AI-243: M9.8). It saves the
 * way project settings do (AI-339): a step's tier and a provider's switch save at once, a
 * provider's number when its field is left, and each tier with its own Save (a route spans three
 * selects, and a half-edited one is refused). One optional reason goes with the next save. Each
 * save sends the last saved routing with that one part changed, against the version it was read
 * at; a newer version arriving (another tab, MCP) keeps unsaved edits and offers a reload. A
 * refused tier keeps its draft and puts each of the API's reasons next to the route it names.
 * Each route shows why the resolver would skip it (AI-238: M9.6), and for a project, a route
 * global doesn't list for that tier.
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
  // What the server holds as far as this editor knows; every save builds on it.
  const [saved, setSaved] = useState<Fields>(() => fieldsOf(start));
  // Unsaved edits: provider numbers being typed and tiers being edited.
  const [draft, setDraft] = useState<Fields>(() => fieldsOf(start));
  // The version `saved` was read at: saves go against it, so a change elsewhere is a 409.
  const [base, setBase] = useState(ifUpdatedAt);
  const [reason, setReason] = useState("");
  const [part, setPart] = useState<Part | null>(null);
  const save = useSaveRouting(projectId);
  // Bumped by Reload, so the fields that hold typed text start again from the new values.
  const [loads, setLoads] = useState(0);
  const reload = () => {
    setLoads((n) => n + 1);
    save.reset();
    setPart(null);
    setSaved(fieldsOf(start));
    setDraft(fieldsOf(start));
    setBase(ifUpdatedAt);
  };
  const changedElsewhere = ifUpdatedAt !== base;
  // Percentages being typed that aren't whole numbers from 0 to 100: nothing is saved until fixed.
  const invalid = ProviderKey.options.flatMap((key) =>
    (["reservePct", "warnPct", "pausePct"] as const)
      .filter((f) => !Number.isInteger(draft.providers[key][f]))
      .map((f) => `${key} ${f.replace("Pct", "")}`),
  );
  const errors = routingErrors(
    part !== null && part !== "providers" && part !== "steps" ? save.error : null,
  );
  const generalError =
    part === "providers" || part === "steps" ? routingErrors(save.error).general : errors.general;

  const write = (which: Part, next: Fields) => {
    setPart(which);
    save.mutate(
      { ...next, ifUpdatedAt: base, reason: reason.trim() || undefined },
      {
        onSuccess: (config) => {
          setBase(config.updatedAt);
          setSaved(structuredClone(next));
          setReason("");
        },
      },
    );
  };
  // Any edit clears an old refusal: its route numbers may no longer match the draft.
  const editDraft = (next: Fields) => {
    if (save.isError) save.reset();
    setDraft(next);
  };
  const commitProviders = (providers: Fields["providers"]) => {
    const bad = ProviderKey.options.some((key) =>
      (["reservePct", "warnPct", "pausePct"] as const).some(
        (f) => !Number.isInteger(providers[key][f]),
      ),
    );
    if (bad || sameJson(providers, saved.providers)) return;
    write("providers", { ...saved, providers });
  };

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
  const cue = (which: Part) =>
    part === which && <SavedCue pending={save.isPending} saved={save.isSuccess} />;

  return (
    <form
      aria-label={projectId === null ? "Global routing" : `Routing for ${projectId}`}
      className="space-y-4"
      onSubmit={(e) => {
        // Enter in a provider's number saves it, as leaving the field does.
        e.preventDefault();
        commitProviders(draft.providers);
      }}
    >
      {changedElsewhere && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md bg-attention/15 p-2 text-sm text-attention"
        >
          Routing changed since you opened it; saves from here will be refused until you reload.
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11 sm:h-8"
            onClick={reload}
          >
            Reload
          </Button>
        </div>
      )}
      <Input
        aria-label="Reason for the change"
        placeholder="Why (optional; goes with the next save into the change log)"
        className="h-11 max-w-md text-base sm:h-9 sm:text-sm"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {generalError.length > 0 && (
        <div role="alert" className="rounded-md bg-destructive/15 p-2 text-sm text-destructive">
          {generalError.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <div>
        <ProviderSettings
          key={loads}
          providers={draft.providers}
          onChange={(p) => editDraft({ ...draft, providers: p })}
          onCommit={commitProviders}
        />
        {cue("providers")}
        {invalid.length > 0 && (
          <p role="alert" className="text-xs text-destructive">
            Not saved: {invalid.join(", ")} must be a whole number from 0 to 100.
          </p>
        )}
      </div>
      <section aria-label="Tiers" className="space-y-2">
        <h3 className="text-sm font-medium">Tiers</h3>
        <p className="text-xs text-muted-foreground">
          The first usable route of a tier runs; the rest are skipped with the reason shown. Each
          tier saves on its own.
        </p>
        <div className="grid gap-2 lg:grid-cols-2">
          {TierKey.options.map((tier) => {
            const changed = !sameJson(draft.tiers[tier], saved.tiers[tier]);
            return (
              <div key={tier} className="space-y-1">
                <TierRoutes
                  tier={tier}
                  routes={draft.tiers[tier]}
                  onChange={(routes) =>
                    editDraft({ ...draft, tiers: { ...draft.tiers, [tier]: routes } })
                  }
                  skipReason={skipReason(tier)}
                  refusal={(i) =>
                    part === tier ? errors.routes.get(routeKey(tier, i)) : undefined
                  }
                />
                <div className="flex items-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-11 sm:h-8"
                    disabled={!changed || save.isPending}
                    onClick={() =>
                      write(tier, {
                        ...saved,
                        tiers: { ...saved.tiers, [tier]: draft.tiers[tier] },
                      })
                    }
                  >
                    Save {tier}
                  </Button>
                  {cue(tier)}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <div>
        <StepTiers
          steps={draft.steps}
          onChange={(steps) => {
            setDraft({ ...draft, steps });
            write("steps", { ...saved, steps });
          }}
        />
        {cue("steps")}
      </div>
    </form>
  );
}
