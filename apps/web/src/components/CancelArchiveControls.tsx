import { useState } from "react";
import type { Ticket } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { QueryError } from "@/components/Status";
import { useArchiveTicket, useCancelTicket } from "@/lib/queries";
import { canArchive } from "@/lib/tickets";

/**
 * Cancel and archive (AI-15: Cancel and archive tickets). Cancel works from any stage, stops the
 * ticket's run in flight first, and takes an optional reason for the history; reopening is the
 * Move to Backlog button. Archive hides a Done or Cancelled ticket from the board and inbox.
 */
export function CancelArchiveControls({ ticket }: { ticket: Ticket }) {
  const path = { projectId: ticket.projectId, ticketId: ticket.id };
  const cancel = useCancelTicket(path);
  const archive = useArchiveTicket(path);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const pending = cancel.isPending || archive.isPending;

  return (
    <section aria-label="Cancel and archive" className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {ticket.stage !== "cancelled" && !cancelling && (
          <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
            Cancel ticket…
          </Button>
        )}
        {ticket.archived ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => archive.mutate({ archived: false })}
          >
            Unarchive
          </Button>
        ) : (
          canArchive(ticket) && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => archive.mutate({ archived: true })}
            >
              Archive
            </Button>
          )
        )}
      </div>

      {cancelling && (
        <form
          className="space-y-2 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate(
              { reason: reason.trim() || null },
              {
                onSuccess: () => {
                  setCancelling(false);
                  setReason("");
                },
              },
            );
          }}
        >
          <Field label="Why cancel (optional)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Cancel ticket
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setCancelling(false)}>
              Keep it
            </Button>
          </div>
        </form>
      )}

      {cancel.error && <QueryError error={cancel.error} />}
      {archive.error && <QueryError error={archive.error} />}
    </section>
  );
}
