import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Loading, QueryError } from "@/components/Status";
import { useCreateProject, useProjects } from "@/lib/queries";

/** Project picker; each project opens its ticket board. M2 adds filtering across projects. */
export function ProjectsPage() {
  const projects = useProjects();
  const create = useCreateProject();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");

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
          </li>
        ))}
      </ul>

      <form
        className="max-w-md space-y-3 rounded-md border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name: name.trim(), key: key.trim() },
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
        {create.error && <QueryError error={create.error} />}
        <Button type="submit" disabled={create.isPending}>
          Create project
        </Button>
      </form>
    </section>
  );
}
