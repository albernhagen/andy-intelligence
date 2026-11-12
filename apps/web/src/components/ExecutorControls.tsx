import { ExecutorKind, type Project, type Ticket } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/Status";
import { useExecutor, useSetExecutor, useUpdateProject } from "@/lib/queries";

/** Where a ticket's runs execute (ADR-0089): the ticket's switch and the project default. */

const EXECUTOR_LABELS: Record<ExecutorKind, string> = {
  actions: "GitHub Actions",
  local: "Local runner",
};

/** The ticket's side rail: its executor, and one click to switch between Actions and local. */
export function ExecutorControl({ ticket }: { ticket: Ticket }) {
  const path = { projectId: ticket.projectId, ticketId: ticket.id };
  const view = useExecutor(path).data;
  const set = useSetExecutor(path);
  if (!view) return null;
  const other: ExecutorKind = view.executor === "local" ? "actions" : "local";
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Runs on</span>
        <Badge>{EXECUTOR_LABELS[view.executor]}</Badge>
        {view.override === null && (
          <span className="text-xs text-muted-foreground">(project default)</span>
        )}
      </p>
      <p className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={set.isPending}
          onClick={() => set.mutate({ executor: other })}
        >
          {other === "local" ? "Run locally" : "Run on Actions"}
        </Button>
        {view.override !== null && (
          <Button
            size="sm"
            variant="ghost"
            disabled={set.isPending}
            onClick={() => set.mutate({ executor: null })}
          >
            Use project executor
          </Button>
        )}
      </p>
      {set.error && <QueryError error={set.error} />}
    </div>
  );
}

/** Where tickets without their own pick run; applies to existing tickets too. */
export function DefaultExecutorSelect({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <label className="ml-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
      Default executor
      <select
        className="rounded border border-border bg-background px-1"
        value={project.executor}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ executor: ExecutorKind.parse(e.target.value) })}
      >
        {ExecutorKind.options.map((o) => (
          <option key={o} value={o}>
            {EXECUTOR_LABELS[o]}
          </option>
        ))}
      </select>
      {update.error && <QueryError error={update.error} />}
    </label>
  );
}
