import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import type { Ticket } from "@andy/contracts";
import { TicketForm } from "@/components/TicketForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading, QueryError } from "@/components/Status";
import { useCreateTicket, useTickets } from "@/lib/queries";
import { STAGE_LABELS, STAGES, groupByStage } from "@/lib/tickets";

/** Tickets grouped by stage, one column each (M1: no drag-and-drop; moves are on the detail page). */
export function BoardPage() {
  const { projectId } = useParams({ from: "/p/$projectId" });
  const tickets = useTickets(projectId);
  const create = useCreateTicket(projectId);
  const [creating, setCreating] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Tickets</h2>
        {!creating && <Button onClick={() => setCreating(true)}>New ticket</Button>}
      </div>

      {creating && (
        <div className="rounded-md border border-border p-3">
          <TicketForm
            submitLabel="Create ticket"
            pending={create.isPending}
            error={create.error && <QueryError error={create.error} />}
            onCancel={() => setCreating(false)}
            onSubmit={(values) => create.mutate(values, { onSuccess: () => setCreating(false) })}
          />
        </div>
      )}

      {tickets.isPending && <Loading />}
      {tickets.isError && <QueryError error={tickets.error} />}
      {tickets.data && <Columns tickets={tickets.data} projectId={projectId} />}
    </section>
  );
}

function Columns({ tickets, projectId }: { tickets: Ticket[]; projectId: string }) {
  const groups = groupByStage(tickets);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {STAGES.map((stage) => (
        <section
          key={stage}
          aria-label={STAGE_LABELS[stage]}
          className="space-y-2 rounded-md bg-foreground/5 p-2"
        >
          <h3 className="text-sm font-medium">
            {STAGE_LABELS[stage]}{" "}
            <span className="text-muted-foreground">{groups[stage].length}</span>
          </h3>
          {groups[stage].map((t) => (
            <Link
              key={t.id}
              to="/p/$projectId/t/$ticketId"
              params={{ projectId, ticketId: t.id }}
              className="block space-y-1 rounded-md border border-border bg-background p-2 text-sm hover:border-foreground/30"
            >
              <span className="block">
                <span className="text-muted-foreground">{t.key}</span> {t.title}
              </span>
              <span className="flex flex-wrap gap-1">
                <Badge>{t.type}</Badge>
                {t.size && <Badge>{t.size}</Badge>}
                {t.dorStatus === "met" && <Badge variant="ok">DoR</Badge>}
                {t.needsYou && <Badge variant="attention">needs you</Badge>}
              </span>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}
