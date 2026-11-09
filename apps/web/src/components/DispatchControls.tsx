import { RUNS_AT_ONCE_MAX, type DispatchDecision, type Project } from "@andy/contracts";
import { QueryError } from "@/components/Status";
import { useProjects, useUpdateProject } from "@/lib/queries";

const DECISION_TEXT: Record<DispatchDecision, string> = {
  paused: "paused by you",
  project_cap: "at this project's runs-at-once dial",
  global_cap: "at the cap on runs across all projects",
  prs_waiting_cap: "too many agent PRs are waiting for you",
  quota_reserve: "subscription quota is at its reserve",
  started: "started a run",
  nothing_ready: "no Ready ticket can start",
};

/** Why dispatch last did what it did (ADR-0079); nothing while auto-build is off. */
export function DispatchStatus({ project }: { project: Project }) {
  if (!project.autoBuild || !project.lastDispatch) return null;
  const { decision, at } = project.lastDispatch;
  return (
    <span className="ml-3 text-sm text-muted-foreground" title={new Date(at).toLocaleString()}>
      Dispatch: {DECISION_TEXT[decision]}
    </span>
  );
}

/** The status line on a project's board. */
export function BoardDispatchStatus({ projectId }: { projectId: string }) {
  const project = useProjects().data?.find((p) => p.id === projectId);
  return project ? <DispatchStatus project={project} /> : null;
}

/** Andy's dial and pause switch, and the last dispatch decision (ADR-0079). */
export function DispatchControls({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <>
      <label className="ml-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
        Runs at once
        <input
          // Remount after a save or a refetch, so a refused value doesn't stay in the box.
          key={project.runsAtOnce}
          type="number"
          min={1}
          max={RUNS_AT_ONCE_MAX}
          aria-label="Runs at once"
          className="w-12 rounded-md border border-border bg-background px-1"
          defaultValue={project.runsAtOnce}
          disabled={update.isPending}
          onBlur={(e) => {
            const value = Number(e.target.value);
            if (Number.isInteger(value) && value !== project.runsAtOnce) {
              update.mutate({ runsAtOnce: value });
            }
          }}
        />
      </label>
      <label className="ml-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={project.paused}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ paused: e.target.checked })}
        />
        Paused
      </label>
      {update.error && <QueryError error={update.error} />}
      <DispatchStatus project={project} />
    </>
  );
}
