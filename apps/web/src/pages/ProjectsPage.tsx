import { useState } from "react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
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
    return <QueryError error={projects.error} />;
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

/** Creates a project and opens its board. */
function NewProjectForm() {
  const create = useCreateProject();
  const github = useGitHub();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [repo, setRepo] = useState("");

  return (
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
  );
}
