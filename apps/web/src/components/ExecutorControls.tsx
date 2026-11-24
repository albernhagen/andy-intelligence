import { ExecutorKind, type Project, type Ticket } from "@andy/contracts";
import { OptionCards, type OptionCard } from "@/components/ui/option-cards";
import { QueryError } from "@/components/Status";
import { useExecutor, useSetExecutor, useUpdateProject } from "@/lib/queries";
import { PickerRow } from "@/components/SettingRow";
import { EXECUTOR_OPTIONS, SETTING_LABELS } from "@/lib/settings-labels";

/** Where a ticket's runs execute (ADR-0089): the ticket's switch and the project default. */

export const EXECUTOR_LABELS: Record<ExecutorKind, string> = {
  actions: EXECUTOR_OPTIONS.actions.label,
  local: EXECUTOR_OPTIONS.local.label,
};

/**
 * Where the ticket's agent tasks run (AI-375, handed over from AI-372): every choice as an option
 * card, from the same list as the project default (`EXECUTOR_OPTIONS`), plus "Use project
 * default".
 */
export function ExecutorControl({ ticket }: { ticket: Ticket }) {
  const path = { projectId: ticket.projectId, ticketId: ticket.id };
  const view = useExecutor(path).data;
  const set = useSetExecutor(path);
  if (!view) return null;
  const options: OptionCard<ExecutorKind | "default">[] = [
    ...ExecutorKind.options.map((e) => ({ value: e, ...EXECUTOR_OPTIONS[e] })),
    {
      value: "default",
      label: "Use project default",
      description:
        view.override === null
          ? `Now ${EXECUTOR_LABELS[view.executor]}, from the project.`
          : "Whatever the project says.",
    },
  ];
  return (
    <div className="space-y-1">
      <span className="block text-xs text-muted-foreground">Runs on</span>
      <OptionCards
        label="Runs on"
        className="sm:grid-cols-1"
        value={view.override ?? "default"}
        disabled={set.isPending}
        onValueChange={(v) => set.mutate({ executor: v === "default" ? null : v })}
        options={options}
      />
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
