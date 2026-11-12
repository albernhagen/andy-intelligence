import { Link } from "@tanstack/react-router";
import { Loading, QueryError } from "@/components/Status";
import { useProjects } from "@/lib/queries";
import { showsError } from "@/lib/live";

/** The board under All projects: a board shows one project, so ask which (ADR-0059). */
export function PickProjectPage() {
  const projects = useProjects();
  return (
    <section className="max-w-2xl space-y-4">
      <h2 className="text-lg font-medium">Board</h2>
      <p className="text-muted-foreground">A board shows one project. Pick one:</p>
      {projects.isPending && <Loading />}
      {showsError(projects) && <QueryError error={projects.error} />}
      {projects.data?.length === 0 && (
        <p className="text-muted-foreground">
          No projects yet.{" "}
          <Link to="/projects" className="text-foreground underline-offset-2 hover:underline">
            Add project
          </Link>
        </p>
      )}
      {!!projects.data?.length && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {projects.data.map((p) => (
            <li key={p.id}>
              <Link
                to="/p/$projectId"
                params={{ projectId: p.id }}
                className="flex h-8 items-center gap-2 px-3 hover:bg-muted"
              >
                <span className="font-mono text-xs text-muted-foreground">{p.key}</span> {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
