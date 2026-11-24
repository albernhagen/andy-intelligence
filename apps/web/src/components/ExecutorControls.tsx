import { type ExecutorKind, type Project, type Ticket } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/Status";
import { useExecutor, useSetExecutor, useUpdateProject } from "@/lib/queries";
import { PickerRow } from "@/components/SettingRow";
import { EXECUTOR_OPTIONS, SETTING_LABELS } from "@/lib/settings-labels";

/** Where a ticket's runs execute (ADR-0089): the ticket's switch and the project default. */

export const EXECUTOR_LABELS: Record<ExecutorKind, string> = {
  actions: EXECUTOR_OPTIONS.actions.label,
  local: EXECUTOR_OPTIONS.local.label,
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
    <PickerRow
      label={SETTING_LABELS.executor}
      description="Where tickets without their own pick run; applies to existing tickets too."
      value={project.executor}
      options={EXECUTOR_OPTIONS}
      disabled={update.isPending}
      onValueChange={(executor) => update.mutate({ executor })}
      state={update}
    />
  );
}
