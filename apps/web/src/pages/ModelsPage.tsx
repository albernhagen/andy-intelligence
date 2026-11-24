import { useState } from "react";
import { TierKey } from "@andy/contracts";
import { effectiveRouting } from "@andy/domain";
import { LayerOrderHint } from "@/components/RouteLayers";
import { RoutingChanges } from "@/components/routing/RoutingChanges";
import { RoutingEditor } from "@/components/routing/RoutingEditor";
import { GlobalSpendCaps } from "@/components/spend/GlobalSpendCaps";
import { Loading, QueryError } from "@/components/Status";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjects, useRouting } from "@/lib/queries";
import { SettingsTabs } from "@/components/SettingsTabs";
import { HARNESS_LABELS, PROVIDER_LABELS, TIER_LABELS, modelName } from "@/lib/settings-labels";

const GLOBAL = "global";

/**
 * Settings → Models (AI-243: M9.8; rebuilt on direction A by AI-376): model routing, global or
 * one project's. Four tier cards say what each tier is for and which route runs now; steps pick a
 * tier; providers are switches with plain names. Every change collects in one save bar. A
 * project's config may only narrow global; its "Runs on" line shows what its agent tasks would
 * run on. Below: the change log and the global spend caps.
 */
export function ModelsPage() {
  const routing = useRouting();
  const projects = useProjects().data ?? [];
  const [scope, setScope] = useState<string | null>(null);
  const [reverts, setReverts] = useState(0);
  const data = routing.data;
  const project = scope === null ? undefined : data?.projects.find((p) => p.projectId === scope);
  return (
    <section className="flex flex-col gap-4">
      <SettingsTabs />
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-lg font-semibold">Models</h1>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Routing for
          <Select value={scope ?? GLOBAL} onValueChange={(v) => setScope(v === GLOBAL ? null : v)}>
            <SelectTrigger aria-label="Routing for" className="w-56 text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GLOBAL} description="The ceiling for every project">
                Global
              </SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.key}: {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <p className="text-sm text-muted-foreground sm:ml-auto">
          Global is the ceiling; a project can only narrow it
        </p>
      </header>
      {routing.isPending && <Loading />}
      {routing.isError && (
        <QueryError
          error={routing.error}
          what="the routing settings"
          onRetry={() => void routing.refetch()}
        />
      )}
      {data && scope === null && (
        <>
          <RoutingEditor
            key={`global-${reverts}`}
            projectId={null}
            start={data.global}
            ifUpdatedAt={data.global.updatedAt}
            global={data.global}
          />
          <LayerOrderHint />
          {/* A revert Andy chose starts the editor again from the reverted routing. */}
          <RoutingChanges onReverted={() => setReverts((n) => n + 1)} />
          <GlobalSpendCaps />
        </>
      )}
      {data && project && (
        <>
          <p className="text-sm text-muted-foreground">
            {project.config
              ? "This project has its own routing."
              : "This project follows global; saving gives it its own routing."}
          </p>
          <NarrowedView tiers={effectiveRouting(data.global, project.config).tiers} />
          <RoutingEditor
            key={project.projectId}
            projectId={project.projectId}
            start={project.effective}
            ifUpdatedAt={project.config?.updatedAt ?? null}
            global={data.global}
          />
          <LayerOrderHint />
        </>
      )}
    </section>
  );
}

/** What a project's agent tasks run on after narrowing: each tier's remaining routes. */
function NarrowedView({ tiers }: { tiers: ReturnType<typeof effectiveRouting>["tiers"] }) {
  return (
    <section
      aria-label="Narrowed view"
      className="flex flex-col gap-1 rounded-lg border border-border bg-raised p-3"
    >
      <h2 className="text-sm font-medium">Runs on</h2>
      <ul className="flex flex-col gap-0.5 text-xs">
        {TierKey.options.map((tier) => (
          <li key={tier}>
            <span className="font-medium">{TIER_LABELS[tier].name}:</span>{" "}
            {tiers[tier].length === 0
              ? "no route"
              : tiers[tier]
                  .map(
                    (r) =>
                      `${modelName(r.model)} (${HARNESS_LABELS[r.harness].name} · ${PROVIDER_LABELS[r.provider].name})`,
                  )
                  .join(", ")}
          </li>
        ))}
      </ul>
    </section>
  );
}
