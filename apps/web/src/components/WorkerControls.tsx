import {
  WorkerChoice,
  type Worker,
  type Project,
  type Stage,
  type Ticket,
  type TicketType,
} from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { OptionCards, type OptionCard } from "@/components/ui/option-cards";
import { QueryError } from "@/components/Status";
import { workerStatus } from "@/lib/needs-you";
import { useSetWorker, useTicketRouting, useUpdateProject, useWorker } from "@/lib/queries";
import { layerText } from "@/lib/route-layers";
import { PickerRow } from "@/components/SettingRow";
import { SETTING_LABELS, WORKER_OPTIONS } from "@/lib/settings-labels";

/** Who does the work (ADR-0082): markers, the ticket's one-click switch, the project default. */

/** "Mine" and "Waiting on you", or "Needs a worker". Never an inbox item. */
export function WorkerBadges(props: { worker: Worker; stage: Stage; type: TicketType | null }) {
  const { mine, waiting, needsWorker } = workerStatus(props.worker, props.stage, props.type);
  return (
    <>
      {mine && <Badge>Mine</Badge>}
      {waiting && <Badge variant="attention">Waiting on you</Badge>}
      {needsWorker && <Badge variant="attention">Needs a worker</Badge>}
    </>
  );
}

/** The ticket's own pick, or "default": the worker comes from its epic or the project. */
type TicketWorkerPick = WorkerChoice | "default";

/**
 * The ticket's worker (AI-375, handed over from AI-372): every choice as an option card, from
 * the same list as the project default (`WORKER_OPTIONS`), plus "Use project default", which
 * says where the worker then comes from (its epic or the project, AI-282: M9).
 */
export function WorkerControl({ ticket }: { ticket: Ticket }) {
  const path = { projectId: ticket.projectId, ticketId: ticket.id };
  const view = useWorker(path).data;
  const source = useTicketRouting(path).data?.worker;
  const set = useSetWorker(path);
  if (!view) return null;
  const from = source ? layerText(source) : "project default";
  const options: OptionCard<TicketWorkerPick>[] = [
    ...WorkerChoice.options.map((w) => ({ value: w, ...WORKER_OPTIONS[w] })),
    {
      value: "default",
      label: "Use project default",
      description:
        view.override === null
          ? `Now ${WORKER_OPTIONS[view.worker].label.toLowerCase()}, from the ${from}.`
          : `Whatever the ${from} says.`,
    },
  ];
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Worker</span>
        <WorkerBadges worker={view.worker} stage={ticket.stage} type={ticket.type} />
      </p>
      <OptionCards
        label="Worker"
        className="sm:grid-cols-1"
        value={view.override ?? "default"}
        disabled={set.isPending}
        onValueChange={(v) => set.mutate({ worker: v === "default" ? null : v })}
        options={options}
      />
      {set.error && <QueryError error={set.error} />}
    </div>
  );
}

/** Who works a ticket that has no pick of its own; applies to existing tickets too. */
export function DefaultWorkerSelect({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <PickerRow
      label={SETTING_LABELS.defaultWorker}
      description="Who works a ticket that has no pick of its own; applies to existing tickets too."
      value={project.defaultWorker}
      options={WORKER_OPTIONS}
      disabled={update.isPending}
      onValueChange={(defaultWorker) => update.mutate({ defaultWorker })}
      state={update}
    />
  );
}
