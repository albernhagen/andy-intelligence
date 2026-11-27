import { ListSkeleton } from "@/components/PageSkeleton";
import { QueryError } from "@/components/Status";
import { EmptyState } from "@/components/ui/empty-state";
import { useReleases } from "@/lib/queries";
import { DeploymentRow } from "./DeploymentRow";

/** Set-up steps for a project's environments, linked when there is nothing to list. */
export const DEPLOY_RUNBOOK =
  "https://github.com/albernhagen/andy-intelligence/blob/main/docs/runbooks/project-env.md";

/** One environment's column on the Releases page (AI-189: M6.10): its deployments, newest first. */
export function EnvironmentReleases({
  projectId,
  environment,
  repo,
}: {
  projectId: string;
  environment: "prod" | "dev";
  repo: string | null;
}) {
  const releases = useReleases(projectId, environment);
  return (
    <section aria-label={environment} className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold">{environment}</h3>
      {releases.isPending ? (
        <ListSkeleton />
      ) : releases.isError ? (
        <QueryError
          error={releases.error}
          what={`${environment} deployments`}
          onRetry={() => void releases.refetch()}
        />
      ) : releases.data.items.length === 0 ? (
        <EmptyState
          title={`No deployments to ${environment} yet.`}
          description="A deployment shows here once the project's deploy workflow reports one."
          action={<RunbookLink />}
        />
      ) : (
        <ul className="space-y-2">
          {releases.data.items.map((item) => (
            <DeploymentRow key={item.deployment.id} item={item} projectId={projectId} repo={repo} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function RunbookLink() {
  return (
    <a
      href={DEPLOY_RUNBOOK}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center text-sm underline underline-offset-2 max-sm:min-h-11"
    >
      Deploy runbook
    </a>
  );
}
