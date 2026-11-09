import { Worker, type Project, type Stage, type Ticket, type TicketType } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/Status";
import { workerStatus } from "@/lib/needs-you";
import { useSetWorker, useUpdateProject, useWorker } from "@/lib/queries";

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

/** The ticket's side rail: its worker, and one click to switch between agent and Andy. */
export function WorkerControl({ ticket }: { ticket: Ticket }) {
  const path = { projectId: ticket.projectId, ticketId: ticket.id };
  const view = useWorker(path).data;
  const set = useSetWorker(path);
  if (!view) return null;
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Worker</span>
        {view.worker === "agent" && <Badge>Agent</Badge>}
        <WorkerBadges worker={view.worker} stage={ticket.stage} type={ticket.type} />
        {view.override === null && (
          <span className="text-xs text-muted-foreground">(project default)</span>
        )}
      </p>
      <p className="flex flex-wrap gap-2">
        {view.worker !== "me" && (
          <Button
            size="sm"
            variant="outline"
            disabled={set.isPending}
            onClick={() => set.mutate({ worker: "me" })}
          >
            Make it mine
          </Button>
        )}
        {view.worker !== "agent" && (
          <Button
            size="sm"
            variant="outline"
            disabled={set.isPending}
            onClick={() => set.mutate({ worker: "agent" })}
          >
            Give to agent
          </Button>
        )}
        {view.override !== null && (
          <Button
            size="sm"
            variant="ghost"
            disabled={set.isPending}
            onClick={() => set.mutate({ worker: null })}
          >
            Use project default
          </Button>
        )}
      </p>
      {set.error && <QueryError error={set.error} />}
    </div>
  );
}

const DEFAULT_WORKER_LABELS: Record<Worker, string> = {
  agent: "agent",
  me: "me",
  ask: "ask each ticket",
};

/** Who works a ticket that has no pick of its own; applies to existing tickets too. */
export function DefaultWorkerSelect({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <label className="ml-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
      Default worker
      <select
        className="rounded border border-border bg-background px-1"
        value={project.defaultWorker}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ defaultWorker: Worker.parse(e.target.value) })}
      >
        {Worker.options.map((o) => (
          <option key={o} value={o}>
            {DEFAULT_WORKER_LABELS[o]}
          </option>
        ))}
      </select>
      {update.error && <QueryError error={update.error} />}
    </label>
  );
}
