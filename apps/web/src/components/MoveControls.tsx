import { useState } from "react";
import type { Stage, Ticket } from "@andy/contracts";
import { isForwardMove } from "@andy/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { QueryError } from "@/components/Status";
import { useMoveTicket, useSetUpNext } from "@/lib/queries";
import { STAGE_LABELS, moveOptions } from "@/lib/tickets";

/**
 * The move a ticket would normally make next: the one-step forward move, or reopening a
 * cancelled ticket. Null on Done, where nothing moves forward.
 */
export function nextMove(stage: Stage): Stage | null {
  const { allowed } = moveOptions(stage);
  return allowed.find((s) => isForwardMove(stage, s)) ?? allowed[0] ?? null;
}

/**
 * Stage moves (ARCHITECTURE §4.1), led by the decision (AI-336): the next move is the panel's one
 * primary button; the other allowed moves, Up next and Andy's forced move to any other stage
 * (ADR-0057, optional reason; history marks it forced) sit under "Move…". The API enforces the
 * rules (e.g. DoR for Backlog → Ready); its errors show here.
 */
export function MoveControls({ ticket }: { ticket: Ticket }) {
  const move = useMoveTicket({ projectId: ticket.projectId, ticketId: ticket.id });
  const upNext = useSetUpNext(ticket.projectId);
  const inUpNext = ticket.upNextRank !== null;
  const { allowed, forced } = moveOptions(ticket.stage);
  const next = nextMove(ticket.stage);
  const others = allowed.filter((s) => s !== next);
  const [more, setMore] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [to, setTo] = useState<Stage | "">("");
  const [reason, setReason] = useState("");

  return (
    <section aria-label="Move" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Stage</span>
          <Badge>{STAGE_LABELS[ticket.stage]}</Badge>
        </span>
        {next && (
          <Button
            size="sm"
            disabled={move.isPending}
            onClick={() => move.mutate({ to: next, force: false, reason: null })}
          >
            Move to {STAGE_LABELS[next]}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={more}
          aria-controls={`more-moves-${ticket.id}`}
          onClick={() => {
            // Collapsing Move… closes the force form with it, so the two never disagree.
            if (more) setForcing(false);
            setMore(!more);
          }}
        >
          Move…
        </Button>
      </div>

      {more && (
        <div id={`more-moves-${ticket.id}`} className="flex flex-wrap gap-2">
          {others.map((s) => (
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
          {ticket.stage === "backlog" && (
            <Button
              size="sm"
              variant="outline"
              disabled={upNext.isPending}
              onClick={() => upNext.mutate({ ticketId: ticket.id, upNext: !inUpNext })}
            >
              {inUpNext ? "Back to Ideas" : "Move to Up next"}
            </Button>
          )}
          {!forcing && (
            <Button size="sm" variant="ghost" onClick={() => setForcing(true)}>
              Force move…
            </Button>
          )}
        </div>
      )}

      {upNext.error && <QueryError error={upNext.error} />}
      {more && forcing && (
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
            {/* Outline: the next move stays the panel's one primary button (design.md). */}
            <Button type="submit" size="sm" variant="outline" disabled={move.isPending || !to}>
              Force move
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setForcing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {move.error && <QueryError error={move.error} />}
    </section>
  );
}
