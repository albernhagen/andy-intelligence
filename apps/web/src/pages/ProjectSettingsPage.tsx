import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import { AutoMerge, PlanApproval, type Project } from "@andy/contracts";
import { ClearQuotaIdle } from "@/components/ClearQuotaIdle";
import { DispatchControls } from "@/components/DispatchControls";
import { ProjectPlanPanel } from "@/components/ProjectPlan";
import { EmailNotificationsControl } from "@/components/EmailControls";
import { Loading, QueryError } from "@/components/Status";
import { DefaultWorkerSelect } from "@/components/WorkerControls";
import { DefaultExecutorSelect } from "@/components/ExecutorControls";
import { useProjects, useUpdateProject } from "@/lib/queries";
import { showsError } from "@/lib/live";

/**
 * One project's settings (AI-46), linked from the workspace header. Every switch saves on change
 * through PATCH /api/projects/{id}, the same rules MCP's set_* tools use. Builds has no MCP setter
 * (ADR-0063); `get_project_settings` reads all of them.
 */
export function ProjectSettingsPage() {
  const { projectId } = useParams({ strict: false });
  const projects = useProjects();
  if (projects.isPending) return <Loading />;
  if (projects.data === undefined || showsError(projects))
    return <QueryError error={projects.error} />;
  const project = projects.data.find((p) => p.id === projectId);
  if (!project) return <p className="text-muted-foreground">Project not found.</p>;

  return (
    <section className="max-w-2xl space-y-4">
      <h2 className="text-lg font-medium">
        {project.key}: {project.name} settings
      </h2>
      {project.repos.length > 0 && (
        <p className="text-sm text-muted-foreground">Repos: {project.repos.join(", ")}</p>
      )}
      <ProjectPlanPanel projectId={project.id} />
      <ul aria-label="Settings" className="divide-y divide-border rounded-md border border-border">
        <Setting what="Build tasks may start at all, by hand or on their own. Owner only: set here in the app, never over MCP. Turn on after the live sandbox proof.">
          <BuildsEnabledToggle project={project} />
        </Setting>
        <Setting what="Ready tickets are built on their own, top of the order first. Needs Builds on.">
          <AutoBuildToggle project={project} />
        </Setting>
        <Setting what="Which tickets wait for you to approve a read-only plan before their build.">
          <PlanApprovalSelect project={project} />
        </Setting>
        <Setting what="Refine starts on its own for tickets entering Up next and answered ones.">
          <AutoRefineToggle project={project} />
        </Setting>
        <Setting what="Refine questions this project asks per rolling 24 hours; extras become assumptions.">
          <DailyQuestionCap project={project} />
        </Setting>
        <Setting what="Which tickets' agent PRs merge on their own once every check and both reviews pass.">
          <AutoMergeSelect project={project} />
        </Setting>
        <Setting what="Agent tasks at once: agent tasks this project may have in flight (1 to 4). Paused: dispatch starts nothing here; agent tasks in flight finish.">
          <DispatchControls project={project} />
          <ClearQuotaIdle />
        </Setting>
        <Setting what="Who works a ticket that has no pick of its own; applies to existing tickets too.">
          <DefaultWorkerSelect project={project} />
        </Setting>
        <Setting what="Where tickets without their own pick run: GitHub Actions, or your local runner while it is present (else Actions).">
          <DefaultExecutorSelect project={project} />
        </Setting>
        <Setting what="Email you when a ticket here starts to need you: items within 10 minutes share one email, at most 20 a day.">
          <EmailNotificationsControl project={project} />
        </Setting>
      </ul>
    </section>
  );
}

/** A row: the control, then one line on what it does. */
function Setting({ what, children }: { what: string; children: ReactNode }) {
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="-ml-3 flex flex-wrap items-center gap-y-1">{children}</div>
      <p className="text-xs text-muted-foreground">{what}</p>
    </li>
  );
}

/** Refine questions the project takes per rolling 24 hours; extras become assumptions (ADR-0075). */
function DailyQuestionCap({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <label className="ml-3 inline-flex items-center gap-1 text-sm">
      Questions per day
      <input
        type="number"
        min={0}
        max={50}
        aria-label="Questions per day"
        className="w-14 rounded-md border border-border bg-background px-1"
        defaultValue={project.dailyQuestionCap}
        disabled={update.isPending}
        onBlur={(e) => {
          const value = Number(e.target.value);
          if (Number.isInteger(value) && value !== project.dailyQuestionCap) {
            update.mutate({ dailyQuestionCap: value });
          }
        }}
      />
      {update.error && <QueryError error={update.error} />}
    </label>
  );
}

/** On: refine starts on its own for tickets entering Up next and answered ones (ADR-0075). */
function AutoRefineToggle({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <label className="ml-3 inline-flex items-center gap-1 text-sm">
      <input
        type="checkbox"
        checked={project.autoRefine}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ autoRefine: e.target.checked })}
      />
      Auto-refine
      {update.error && <QueryError error={update.error} />}
    </label>
  );
}

/**
 * On: build runs may start at all, by hand or on their own (ADR-0063). Turn on only after the live
 * sandbox proof (runbook agent-runs.md §9); who and when are recorded and shown.
 */
function BuildsEnabledToggle({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const when = project.buildEnabledAt
    ? new Date(project.buildEnabledAt).toLocaleDateString()
    : null;
  return (
    <label className="ml-3 inline-flex items-center gap-1 text-sm">
      <input
        type="checkbox"
        checked={project.buildEnabled}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ buildEnabled: e.target.checked })}
      />
      Builds
      {project.buildEnabledBy && when && (
        <span className="text-muted-foreground" title={`by ${project.buildEnabledBy}`}>
          ({project.buildEnabled ? "on" : "off"} since {when})
        </span>
      )}
      {update.error && <QueryError error={update.error} />}
    </label>
  );
}

/** On: Ready tickets are built on their own, top of the order first (ADR-0063); needs Builds on. */
function AutoBuildToggle({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <label className="ml-3 inline-flex items-center gap-1 text-sm">
      <input
        type="checkbox"
        checked={project.autoBuild}
        disabled={update.isPending || !project.buildEnabled}
        onChange={(e) => update.mutate({ autoBuild: e.target.checked })}
      />
      Auto-build
      {update.error && <QueryError error={update.error} />}
    </label>
  );
}

const PLAN_APPROVAL_LABELS: Record<PlanApproval, string> = {
  none: "none",
  "m-and-l": "M and L tickets",
  all: "all tickets",
};

/** Which tickets wait for Andy to approve a read-only plan before their build (ADR-0050). */
function PlanApprovalSelect({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <label className="ml-3 inline-flex items-center gap-1 text-sm">
      Plan approval
      <select
        className="rounded border border-border bg-background px-1"
        value={project.planApproval}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ planApproval: e.target.value as PlanApproval })}
      >
        {PlanApproval.options.map((o) => (
          <option key={o} value={o}>
            {PLAN_APPROVAL_LABELS[o]}
          </option>
        ))}
      </select>
      {update.error && <QueryError error={update.error} />}
    </label>
  );
}

const AUTO_MERGE_LABELS: Record<AutoMerge, string> = {
  none: "none",
  s: "S tickets",
  "s-and-m": "S and M tickets",
  all: "all tickets",
};

/** Which tickets' agent PRs merge on their own once the gate passes (ADR-0050). */
function AutoMergeSelect({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <label className="ml-3 inline-flex items-center gap-1 text-sm">
      Auto-merge
      <select
        className="rounded border border-border bg-background px-1"
        value={project.autoMerge}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ autoMerge: e.target.value as AutoMerge })}
      >
        {AutoMerge.options.map((o) => (
          <option key={o} value={o}>
            {AUTO_MERGE_LABELS[o]}
          </option>
        ))}
      </select>
      {update.error && <QueryError error={update.error} />}
    </label>
  );
}
