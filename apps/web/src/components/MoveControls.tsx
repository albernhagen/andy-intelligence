import { useState } from "react";
import type { Stage, Ticket } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { QueryError } from "@/components/Status";
import { useMoveTicket } from "@/lib/queries";
import { STAGE_LABELS, moveOptions } from "@/lib/tickets";

/**
 * Stage moves (ARCHITECTURE §4.1): one button per move the domain allows, plus Andy's forced
 * move to any other stage, with an optional reason (ADR-0054); history marks it forced.
 * The API enforces the rules (e.g. DoR for Backlog → Ready); its errors show here.
 */
export function MoveControls({ ticket }: { ticket: Ticket }) {
  const move = useMoveTicket({ projectId: ticket.projectId, ticketId: ticket.id });
  const { allowed, forced } = moveOptions(ticket.stage);
  const [forcing, setForcing] = useState(false);
  const [to, setTo] = useState<Stage | "">("");
  const [reason, setReason] = useState("");

  return (
    <section aria-label="Move" className="space-y-2">
      <h3 className="text-sm font-medium">Move</h3>
      <div className="flex flex-wrap gap-2">
        {allowed.map((s) => (
          <Button
            key={s}
            size="sm"
            variant="outline"
            disabled={move.isPending}
            onClick={() => move.mutate({ to: s, force: false, reason: null })}
          >
            Move to {STAGE_LABELS[s]}
          </Button>
        ))}
        {!forcing && (
          <Button size="sm" variant="ghost" onClick={() => setForcing(true)}>
            Force move…
          </Button>
        )}
      </div>

      {forcing && (
        <form
          className="space-y-2 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!to) return;
            move.mutate(
              { to, force: true, reason: reason.trim() || null },
              {
                onSuccess: () => {
                  setForcing(false);
                  setTo("");
                  setReason("");
                },
              },
            );
          }}
        >
          <Field label="Force to">
            <Select required value={to} onChange={(e) => setTo(e.target.value as Stage)}>
              <option value="">Pick a stage</option>
              {forced.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (optional)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={move.isPending || !to}>
              Force move
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setForcing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {move.error && <QueryError error={move.error} />}
    </section>
  );
}
