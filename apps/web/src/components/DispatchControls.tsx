import { RUNS_AT_ONCE_MAX, type DispatchDecision, type Project } from "@andy/contracts";
import { QueryError } from "@/components/Status";
import { useProjects, useUpdateProject } from "@/lib/queries";
import type { Scope } from "@/lib/scope";
import { cn } from "@/lib/utils";
import { SavedCue } from "@/components/SavedCue";
import { dateTime } from "@/lib/format";

const DECISION_TEXT: Record<DispatchDecision, string> = {
  paused: "paused by you",
  project_cap: "at this project's agent-tasks-at-once dial",
  global_cap: "at the cap on agent tasks across all projects",
  prs_waiting_cap: "too many agent PRs are waiting for you",
  quota_reserve: "subscription quota is at its reserve",
  quota_warn: "subscription quota is at warn: one agent task at a time across all projects",
  spend_cap: "a paid agent task would pass a spend cap, or its cost is unknown",
  started: "started an agent task",
  nothing_ready: "no Ready ticket can start",
  touches_overlap: "Ready tickets overlap agent tasks in flight",
  milestone_held: "Ready tickets wait: their milestone isn't approved",
};

/** Why dispatch last did what it did (ADR-0079); nothing while auto-build is off. */
export function DispatchStatus({ project }: { project: Project }) {
  if (!project.autoBuild || !project.lastDispatch) return null;
  const { decision, at } = project.lastDispatch;
  return (
    <span className="ml-3 text-sm text-muted-foreground" title={dateTime(at)}>
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
      <label className="ml-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground md:min-h-0">
        Agent tasks at once
        <input
          // Remount after a save or a refetch, so a refused value doesn't stay in the box.
          key={project.runsAtOnce}
          type="number"
          min={1}
          max={RUNS_AT_ONCE_MAX}
          aria-label="Agent tasks at once"
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
      <label className="ml-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground md:min-h-0">
        <input
          type="checkbox"
          className="size-5 md:size-auto"
          checked={project.paused}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ paused: e.target.checked })}
        />
        Paused
      </label>
      {update.error && <QueryError error={update.error} />}
      <SavedCue pending={update.isPending} saved={update.isSuccess} />
      <DispatchStatus project={project} />
    </>
  );
}

/**
 * The project the header's pause button acts on: the one in scope, or the only project when the
 * scope is all projects. None when there are several and no project is picked.
 */
function scopedProject(projects: Project[] | undefined, scope: Scope): Project | undefined {
  if (!projects) return undefined;
  if (scope.kind === "project") return projects.find((p) => p.id === scope.projectId);
  return projects.length === 1 ? projects[0] : undefined;
}

/**
 * Pause and resume on a phone (AI-176): one tap in the header, from the inbox or any page. Same
 * `paused` setting as the settings page's switch (ADR-0079); hidden from `md` up, where that
 * page is a tap away.
 */
export function PhonePauseButton({ scope }: { scope: Scope }) {
  const project = scopedProject(useProjects().data, scope);
  return project ? <PauseButton key={project.id} project={project} /> : null;
}

function PauseButton({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const failed = !!update.error;
  return (
    <button
      type="button"
      aria-pressed={project.paused}
      aria-label={`${project.paused ? "Resume" : "Pause"} dispatch for ${project.name}${failed ? " (last change failed)" : ""}`}
      title={failed ? "The last change failed; tap to try again." : undefined}
      disabled={update.isPending}
      onClick={() => update.mutate({ paused: !project.paused })}
      className={cn(
        "min-h-11 min-w-11 rounded-md border border-border px-2 text-xs font-medium disabled:opacity-50 md:hidden",
        project.paused ? "bg-attention/15 text-attention" : "bg-background text-foreground",
        failed && "border-destructive text-destructive",
      )}
    >
      {project.paused ? "Resume" : "Pause"}
    </button>
  );
}
