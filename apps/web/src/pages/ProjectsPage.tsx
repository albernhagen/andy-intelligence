import { useState } from "react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandLine, ExternalButton } from "@/components/setup/HandStep";
import { Field, Input } from "@/components/ui/input";
import { Loading, QueryError } from "@/components/Status";
import { loadScope } from "@/lib/scope";
import { useCreateProject, useGitHub, useProjects } from "@/lib/queries";
import { showsError } from "@/lib/live";

/**
 * `/projects` (AI-46): settings moved to `/p/<project>/settings`, so this opens the current
 * project's (the one last used, else the first). With no projects yet it offers to create one.
 */
export function ProjectsPage() {
  const projects = useProjects();
  if (projects.isPending) return <Loading />;
  if (projects.data === undefined || showsError(projects))
    return (
      <QueryError
        error={projects.error}
        what="the projects"
        onRetry={() => void projects.refetch()}
      />
    );
  const remembered = loadScope();
  const current =
    projects.data.find((p) => remembered.kind === "project" && p.id === remembered.projectId) ??
    projects.data[0];
  if (current) {
    return <Navigate to="/p/$projectId/settings" params={{ projectId: current.id }} replace />;
  }
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-medium">Projects</h2>
      <p className="text-muted-foreground">No projects yet.</p>
      <NewProjectForm />
    </section>
  );
}

/** `/projects/new`: the picker's "Add project". */
export function NewProjectPage() {
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-medium">Add project</h2>
      <NewProjectForm />
    </section>
  );
}

/**
 * Runbook managed-project.md steps 1 and 2 (AI-381): the project needs its repo and the App on it
 * before it can be created, so they show here, before the form, with their commands and the
 * App's install page. The repo's visibility and default branch are checked from the App's
 * installed repos as soon as it is typed; the files are checked on the setup path.
 */
function BeforeYouAdd({ repo }: { repo: string }) {
  const github = useGitHub();
  const name = repo.trim() || "<owner>/<name>";
  const installed = github.data?.repos.find(
    (r) => r.fullName.toLowerCase() === repo.trim().toLowerCase(),
  );
  const limits = installed
    ? [
        { label: "Public", ok: !installed.private, fails: "the repo is private" },
        {
          label: "Default branch main",
          ok: installed.defaultBranch === "main",
          fails: `the default branch is ${installed.defaultBranch}`,
        },
      ]
    : [];
  return (
    <section
      aria-labelledby="before-add-title"
      className="max-w-2xl space-y-3 rounded-md border border-border bg-raised p-3"
    >
      <h3 id="before-add-title" className="font-medium">
        Before you add a project: the repo and the GitHub App
      </h3>
      <p className="text-sm">
        1. Create the repo; a new, empty one: onboard it now (from an andy-intelligence checkout).
      </p>
      <CommandLine label="Create the repo" text={`gh repo create ${name} --public`} />
      <CommandLine
        label="Onboard a new repo"
        text={`node platform/baseline/baseline.mjs onboard ${name} --ref v1.0.0`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">2. Install the GitHub App on the repo.</p>
        {github.data?.installUrl ? (
          <ExternalButton label="Install the GitHub App" url={github.data.installUrl} />
        ) : (
          <span className="text-xs text-muted-foreground">Connect GitHub in Settings first.</span>
        )}
      </div>
      {repo.trim() && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm" aria-live="polite">
          {installed ? (
            <>
              <Badge variant="success">App installed</Badge>
              {limits.map((l) => (
                <Badge key={l.label} variant={l.ok ? "success" : "danger"}>
                  {l.ok ? `✓ ${l.label}` : `✗ ${l.label}: ${l.fails}`}
                </Badge>
              ))}
            </>
          ) : (
            <Badge>Not yet: the App can't see {repo.trim()}</Badge>
          )}
        </p>
      )}
    </section>
  );
}

/** Creates a project and opens its setup path (AI-373), not an empty board. */
function NewProjectForm() {
  const create = useCreateProject();
  const github = useGitHub();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [repo, setRepo] = useState("");

  return (
    <div className="space-y-4">
      <BeforeYouAdd repo={repo} />
      <form
        className="max-w-md space-y-3 rounded-md border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name: name.trim(), key: key.trim(), repos: repo.trim() ? [repo.trim()] : [] },
            {
              onSuccess: (p) =>
                void navigate({ to: "/p/$projectId/setup", params: { projectId: p.id } }),
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
    </div>
  );
}
