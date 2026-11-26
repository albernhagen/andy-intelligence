import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Loading, QueryError } from "@/components/Status";
import { EnvironmentReleases, RunbookLink } from "@/components/releases/EnvironmentReleases";
import { ReleaseActions } from "@/components/releases/ReleaseActions";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { showsError } from "@/lib/live";
import { useProjects } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Releases (AI-189: M6.10, ADR-0114) under `/p/<project>/releases`: one column per environment
 * the project has, each listing its deployments newest first; a deployment expands to its release
 * notes. Reached from What's new (the six destinations are full, AI-335). Promote and rollback are
 * AI-199: M6.12's `ReleaseActions`, above the columns. Project-scoped only: releases are per project.
 */
export function ReleasesPage() {
  const { projectId = "" } = useParams({ strict: false });
  const projects = useProjects();
  const [picked, setPicked] = useState<"prod" | "dev">("prod");

  const header = (
    <PageHeader
      title="Releases"
      actions={
        <Link
          to="/p/$projectId/whats-new"
          params={{ projectId }}
          className="inline-flex items-center text-sm text-muted-foreground underline-offset-2 hover:underline max-sm:min-h-11"
        >
          What's new
        </Link>
      }
    />
  );

  if (projects.isPending) return <Loading />;
  if (projects.data === undefined || showsError(projects))
    return (
      <QueryError
        error={projects.error}
        what="the projects"
        onRetry={() => void projects.refetch()}
      />
    );
  const project = projects.data.find((p) => p.id === projectId);
  if (!project) return <p className="text-muted-foreground">Project not found.</p>;

  if (project.deployKind === "none")
    return (
      <section>
        {header}
        <EmptyState
          title="This project doesn't deploy."
          description="Its deploy kind is none, so it has no environments or deployments. Pick a deploy kind in the project's settings, then set the environments up with the deploy runbook."
          action={<RunbookLink />}
        />
      </section>
    );

  const environments: ("dev" | "prod")[] =
    project.environments === "dev-and-prod" ? ["dev", "prod"] : ["prod"];
  const repo = project.repos[0] ?? null;
  return (
    <section>
      {header}
      <div className="space-y-4">
        <ReleaseActions
          projectId={projectId}
          deployKind={project.deployKind}
          environments={project.environments}
        />
        {environments.length > 1 && (
          // Below sm the columns show one at a time (design.md "Phone").
          <Segmented
            label="Environment"
            value={picked}
            options={environments.map((e) => ({ value: e, label: e }))}
            onChange={setPicked}
            className="sm:hidden"
          />
        )}
        <div className={cn("grid items-start gap-4", environments.length > 1 && "sm:grid-cols-2")}>
          {environments.map((e) => (
            <div key={e} className={cn("min-w-0", e !== picked && "max-sm:hidden")}>
              <EnvironmentReleases projectId={projectId} environment={e} repo={repo} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
