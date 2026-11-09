import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AutoMerge, PlanApproval, type Project } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Loading, QueryError } from "@/components/Status";
import { useCreateProject, useGitHub, useProjects, useUpdateProject } from "@/lib/queries";

/** Project picker; each project opens its ticket board. M5: Multi-project in parallel adds filtering across projects. */
export function ProjectsPage() {
  const projects = useProjects();
  const create = useCreateProject();
  const github = useGitHub();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [repo, setRepo] = useState("");

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-medium">Projects</h2>
      {projects.isPending && <Loading />}
      {projects.isError && <QueryError error={projects.error} />}
      {projects.data?.length === 0 && <p className="text-muted-foreground">No projects yet.</p>}
      <ul className="space-y-1">
        {projects.data?.map((p) => (
          <li key={p.id}>
            <Link
              to="/p/$projectId"
              params={{ projectId: p.id }}
              className="underline-offset-2 hover:underline"
            >
              {p.key}: {p.name}
            </Link>
            {p.repos.length > 0 && (
              <span className="text-muted-foreground"> ({p.repos.join(", ")})</span>
            )}
            <AutoRefineToggle project={p} />
            <BuildsEnabledToggle project={p} />
            <AutoBuildToggle project={p} />
            <PlanApprovalSelect project={p} />
            <AutoMergeSelect project={p} />
          </li>
        ))}
      </ul>

      <form
        className="max-w-md space-y-3 rounded-md border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name: name.trim(), key: key.trim(), repos: repo.trim() ? [repo.trim()] : [] },
            {
              onSuccess: (p) => void navigate({ to: "/p/$projectId", params: { projectId: p.id } }),
            },
          );
        }}
      >
        <h3 className="font-medium">New project</h3>
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Key (ticket prefix, e.g. AI)">
          <Input
            required
            pattern="[A-Z][A-Z0-9]{0,9}"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="GitHub repo (owner/name, optional; the GitHub App must be installed on it)">
          <Input
            pattern="[A-Za-z0-9\-]+/[A-Za-z0-9._\-]+"
            list="installed-repos"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
        </Field>
        {/* Suggestions from Settings → GitHub; empty when GitHub isn't connected. */}
        <datalist id="installed-repos">
          {github.data?.repos.map((r) => (
            <option key={r.fullName} value={r.fullName} />
          ))}
        </datalist>
        {create.error && <QueryError error={create.error} />}
        <Button type="submit" disabled={create.isPending}>
          Create project
        </Button>
      </form>
    </section>
  );
}

/** On: refine starts on its own for new and answered Backlog tickets (ADR-0054). */
function AutoRefineToggle({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <label className="ml-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
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
    <label className="ml-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
      <input
        type="checkbox"
        checked={project.buildEnabled}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ buildEnabled: e.target.checked })}
      />
      Builds
      {project.buildEnabledBy && when && (
        <span title={`by ${project.buildEnabledBy}`}>
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
    <label className="ml-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
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
    <label className="ml-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
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
    <label className="ml-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
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
