import { useState } from "react";
import { TierKey } from "@andy/contracts";
import { LayerOrderHint } from "@/components/RouteLayers";
import { effectiveRouting } from "@andy/domain";
import { RoutingChanges } from "@/components/routing/RoutingChanges";
import { RoutingEditor } from "@/components/routing/RoutingEditor";
import { GlobalSpendCaps } from "@/components/spend/GlobalSpendCaps";
import { Loading, QueryError } from "@/components/Status";
import { Select } from "@/components/ui/input";
import { useProjects, useRouting } from "@/lib/queries";
import { SettingsNav } from "@/pages/RunnersPage";

/**
 * Settings → Models (AI-243: M9.8): model routing, global or one project's. Providers with their
 * switch and quota levels, each tier's routes in order (the first usable one runs; each skipped
 * one says why), and which tier each step uses. A project's config may only narrow global; its
 * narrowed view shows what its agent tasks would run on.
 */
export function ModelsPage() {
  const routing = useRouting();
  const projects = useProjects().data ?? [];
  const [scope, setScope] = useState<string | null>(null);
  const [reverts, setReverts] = useState(0);
  const data = routing.data;
  const project = scope === null ? undefined : data?.projects.find((p) => p.projectId === scope);
  return (
    <section className="max-w-4xl space-y-4">
      <SettingsNav current="models" />
      <h2 className="text-lg font-medium">Models</h2>
      <p className="text-sm text-muted-foreground">
        Which providers are on, each tier&apos;s routes in order, and which tier each step uses.
        Global is the ceiling: a project can only narrow it. Every save is in the change log.
      </p>
      <LayerOrderHint />
      <label className="flex items-center gap-2 text-sm">
        Routing for
        <Select
          aria-label="Routing for"
          className="h-11 w-auto text-base sm:h-9 sm:text-sm"
          value={scope ?? ""}
          onChange={(e) => setScope(e.target.value || null)}
        >
          <option value="">Global</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key}: {p.name}
            </option>
          ))}
        </Select>
      </label>
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
        </>
      )}
    </section>
  );
}

/** What a project's agent tasks run on after narrowing: each tier's remaining routes. */
function NarrowedView({ tiers }: { tiers: ReturnType<typeof effectiveRouting>["tiers"] }) {
  return (
    <section aria-label="Narrowed view" className="space-y-1 rounded-md border border-border p-2">
      <h3 className="text-sm font-medium">Runs on</h3>
      <ul className="space-y-0.5 text-xs">
        {TierKey.options.map((tier) => (
          <li key={tier}>
            <span className="font-medium">{tier}:</span>{" "}
            {tiers[tier].length === 0
              ? "no route"
              : tiers[tier].map((r) => `${r.harness}/${r.provider}/${r.model}`).join(", ")}
          </li>
        ))}
      </ul>
    </section>
  );
}
