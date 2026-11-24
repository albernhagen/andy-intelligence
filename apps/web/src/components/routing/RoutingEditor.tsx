import { useEffect, useRef, useState } from "react";
import { ProviderKey, TierKey, type Route, type RoutingConfig } from "@andy/contracts";
import { effectiveRouting, routeSkipReason } from "@andy/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { useSaveRouting } from "@/lib/queries";
import { PROVIDER_LABELS, TIER_LABELS } from "@/lib/settings-labels";
import { ProviderSettings } from "./ProviderSettings";
import { StepTiers } from "./StepTiers";
import { TierCard } from "./TierCard";
import { routeKey, routingErrors } from "./routing-errors";
import { routingChanges, type RoutingFields, type RoutingPart } from "./routing-diff";

const fieldsOf = (c: RoutingConfig): RoutingFields =>
  structuredClone({ providers: c.providers, tiers: c.tiers, steps: c.steps });

const sameRoute = (a: Route, b: Route) =>
  a.harness === b.harness && a.provider === b.provider && a.model === b.model;

/** "Cmd+S" on a Mac, "Ctrl+S" elsewhere, for the Save button's key hint. */
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The routing editor for global (`projectId` null) or one project (AI-376: Models). Every change
 * (a route, a step's tier, a provider's switch or levels) collects in one bar at the bottom: how
 * many, what each is, an optional reason for the change log, Discard and Save (Cmd+S). Save sends
 * the whole draft against the version it was read at, as one change. When it lands, each changed
 * card or row says "Saved" where the change was made; a refusal keeps the draft and puts each of
 * the API's reasons next to the route it names, or in the bar. A newer version arriving (another
 * tab, MCP) keeps unsaved edits and offers a reload. For a project, a route global doesn't list
 * for that tier is skipped, since global is the ceiling.
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
  // What the server holds as far as this editor knows, and the version it was read at.
  const [saved, setSaved] = useState<RoutingFields>(() => fieldsOf(start));
  const [base, setBase] = useState(ifUpdatedAt);
  const [draft, setDraft] = useState<RoutingFields>(() => fieldsOf(start));
  const [reason, setReason] = useState("");
  // The parts the last save changed: each shows "Saved" until it is edited again.
  const [justSaved, setJustSaved] = useState<ReadonlySet<RoutingPart>>(new Set());
  // Bumped by Discard and Reload, so fields holding typed text start again.
  const [loads, setLoads] = useState(0);
  const save = useSaveRouting(projectId);

  const changes = routingChanges(saved, draft);
  const edited = new Set(changes.map((c) => c.part));
  const changedElsewhere = ifUpdatedAt !== base;
  // Percentages being typed that aren't whole numbers from 0 to 100: nothing is saved until fixed.
  const invalid = ProviderKey.options.flatMap((key) =>
    (["reservePct", "warnPct", "pausePct"] as const)
      .filter((f) => !Number.isInteger(draft.providers[key][f]))
      .map((f) => `${PROVIDER_LABELS[key].name} ${f.replace("Pct", "")}`),
  );
  const errors = routingErrors(save.error);

  const edit = (next: RoutingFields) => {
    // An old refusal's route numbers may no longer match the draft.
    if (save.isError) save.reset();
    setDraft(next);
  };
  const discard = () => {
    save.reset();
    setDraft(structuredClone(saved));
    setLoads((n) => n + 1);
  };
  const reload = () => {
    save.reset();
    setSaved(fieldsOf(start));
    setDraft(fieldsOf(start));
    setBase(ifUpdatedAt);
    setJustSaved(new Set());
    setLoads((n) => n + 1);
  };
  const canSave = changes.length > 0 && invalid.length === 0 && !save.isPending;
  const submit = async () => {
    if (!canSave) return;
    const next = structuredClone(draft);
    const parts = new Set(changes.map((c) => c.part));
    try {
      const config = await save.mutateAsync({
        ...next,
        ifUpdatedAt: base,
        reason: reason.trim() || undefined,
      });
      setSaved(next);
      setBase(config.updatedAt);
      setReason("");
      setJustSaved(parts);
    } catch {
      // The refusal shows from `save.error`: by its route, or in the bar.
    }
  };
  // Cmd+S / Ctrl+S saves from anywhere on the page, even while typing the reason.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The providers a route runs under: the draft's, narrowed to global for a project.
  const providers =
    projectId === null
      ? draft.providers
      : effectiveRouting(global, { ...start, ...draft }).providers;
  const skipReason = (tier: TierKey) => (route: Route) => {
    if (projectId !== null && !global.tiers[tier].some((g) => sameRoute(g, route))) {
      return `not a global ${TIER_LABELS[tier].name.toLowerCase()} route`;
    }
    return routeSkipReason(route, providers);
  };
  const isSaved = (part: RoutingPart) => justSaved.has(part) && !edited.has(part);

  return (
    <form
      aria-label={projectId === null ? "Global routing" : `Routing for ${projectId}`}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {changedElsewhere && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md bg-attention/15 p-2 text-sm text-attention"
        >
          Routing changed since you opened it; saving from here will be refused until you reload.
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
      <section aria-label="Tiers" className="flex flex-col gap-2">
        <h2 className="font-medium">Tiers</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {TierKey.options.map((tier) => (
            <TierCard
              key={`${tier}-${loads}`}
              tier={tier}
              routes={draft.tiers[tier]}
              edited={edited.has(`tier:${tier}`)}
              saved={isSaved(`tier:${tier}`)}
              onChange={(routes) => edit({ ...draft, tiers: { ...draft.tiers, [tier]: routes } })}
              skipReason={skipReason(tier)}
              refusal={(i) => errors.routes.get(routeKey(tier, i))}
            />
          ))}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <StepTiers
          steps={draft.steps}
          edited={(s) => edited.has(`step:${s}`)}
          saved={(s) => isSaved(`step:${s}`)}
          onChange={(steps) => edit({ ...draft, steps })}
        />
        <ProviderSettings
          key={loads}
          providers={draft.providers}
          edited={(k) => edited.has(`provider:${k}`)}
          saved={(k) => isSaved(`provider:${k}`)}
          onChange={(p) => edit({ ...draft, providers: p })}
        />
      </div>
      {(changes.length > 0 || errors.general.length > 0) && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-selected px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6"
        >
          {errors.general.length > 0 && (
            <div role="alert" className="text-sm text-destructive">
              {errors.general.map((line) => (
                <p key={line}>Not saved: {line}</p>
              ))}
            </div>
          )}
          {invalid.length > 0 && (
            <p role="alert" className="text-xs text-destructive">
              Not saved: {invalid.join(", ")} must be a whole number from 0 to 100.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tabular-nums">
              {changes.length === 1 ? "1 unsaved change" : `${changes.length} unsaved changes`}
            </span>
            <span
              className="min-w-0 truncate text-sm text-muted-foreground"
              title={changes.map((c) => c.summary).join("; ")}
            >
              {changes.map((c) => c.summary).join("; ")}
            </span>
            <Input
              aria-label="Reason for the change"
              placeholder="Why? Goes in the change log (optional)"
              className="h-11 min-w-48 flex-1 bg-raised text-base sm:h-8 sm:text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 sm:h-8"
              disabled={save.isPending}
              onClick={discard}
            >
              Discard
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-11 sm:h-8"
              disabled={!canSave}
              aria-keyshortcuts={isMac ? "Meta+S" : "Control+S"}
            >
              {save.isPending ? "Saving…" : "Save"}
              <Kbd>{isMac ? "⌘S" : "Ctrl S"}</Kbd>
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
