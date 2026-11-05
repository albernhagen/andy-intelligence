import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Stage, type Ticket } from "@andy/contracts";
import { TicketForm } from "@/components/TicketForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading, QueryError } from "@/components/Status";
import { useBoardMove, useCreateTicket, useTickets } from "@/lib/queries";
import {
  STAGE_LABELS,
  STAGES,
  TYPE_LABELS,
  dropMove,
  groupByStage,
  visibleTickets,
} from "@/lib/tickets";

/**
 * Tickets grouped by stage, one column each. Drag a card to another column to move it: an
 * allowed transition is a normal move, any other is a forced one (ADR-0057). The detail page's
 * Move controls do the same with buttons.
 */
export function BoardPage() {
  const { projectId } = useParams({ from: "/p/$projectId" });
  const tickets = useTickets(projectId);
  const create = useCreateTicket(projectId);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Tickets</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          {!creating && <Button onClick={() => setCreating(true)}>New ticket</Button>}
        </div>
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
      {tickets.data && (
        <Columns tickets={visibleTickets(tickets.data, showArchived)} projectId={projectId} />
      )}
    </section>
  );
}

/** Space picks a card up and drops it; Enter stays free to open the ticket link. */
const KEYBOARD_CODES = { start: ["Space"], cancel: ["Escape"], end: ["Space"] };

function Columns({ tickets, projectId }: { tickets: Ticket[]; projectId: string }) {
  const groups = groupByStage(tickets);
  const move = useBoardMove(projectId);
  // One error per card, so a quick second drop can't hide the first one's failure.
  const [errors, setErrors] = useState<Record<string, Error>>({});
  const suppressDropClick = useDropClickSuppression();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { keyboardCodes: KEYBOARD_CODES }),
  );

  async function onDragEnd({ active, over }: DragEndEvent) {
    const ticket = tickets.find((t) => t.id === active.id);
    const to = Stage.safeParse(over?.id);
    if (!ticket || !to.success) return;
    const next = dropMove(ticket.stage, to.data);
    if (!next) return;
    setErrors(({ [ticket.id]: _, ...rest }) => rest);
    // No optimistic update: the card stays in its column until the API accepts the move.
    // mutateAsync, not mutate's per-call callbacks: those only fire for the latest call.
    try {
      await move.mutateAsync({ ticketId: ticket.id, ...next });
    } catch (error) {
      setErrors((e) => ({ ...e, [ticket.id]: error as Error }));
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ activatorEvent }: DragStartEvent) => {
        // A keyboard drag ends with Space, which never clicks the link.
        if (!(activatorEvent instanceof KeyboardEvent)) suppressDropClick();
      }}
      onDragEnd={(e) => void onDragEnd(e)}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        {STAGES.map((stage) => (
          <Column key={stage} stage={stage} count={groups[stage].length}>
            {groups[stage].map((t) => (
              <Card key={t.id} ticket={t} projectId={projectId} error={errors[t.id] ?? null} />
            ))}
          </Column>
        ))}
      </div>
    </DndContext>
  );
}

/**
 * A mouse or touch drag ends with a click on the card's link (AI-25). dnd-kit stops that click's
 * propagation at the document, so a React onClick never sees it and the browser follows the
 * href. A capture listener on window runs before dnd-kit's and cancels the click's default;
 * TanStack's Link skips navigation for a default-prevented click too. The flag lasts until that
 * click or the next pointer press, not a timer. Returns the function that arms it.
 */
function useDropClickSuppression() {
  const armed = useRef(false);
  useEffect(() => {
    function onClick(e: globalThis.MouseEvent) {
      if (!armed.current) return;
      armed.current = false;
      // detail 0 is Enter on the link (a touch drop leaves no click behind): let it open.
      if (e.detail > 0) e.preventDefault();
    }
    function disarm() {
      armed.current = false;
    }
    window.addEventListener("click", onClick, true);
    window.addEventListener("pointerdown", disarm, true);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("pointerdown", disarm, true);
    };
  }, []);
  return () => (armed.current = true);
}

function Column({ stage, count, children }: { stage: Stage; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      aria-label={STAGE_LABELS[stage]}
      data-stage={stage}
      className={`space-y-2 rounded-md p-2 ${isOver ? "bg-foreground/15" : "bg-foreground/5"}`}
    >
      <h3 className="text-sm font-medium">
        {STAGE_LABELS[stage]} <span className="text-muted-foreground">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function Card({
  ticket: t,
  projectId,
  error,
}: {
  ticket: Ticket;
  projectId: string;
  error: Error | null;
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({
    id: t.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div className="space-y-1">
      <Link
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        // dnd-kit's attributes make it a "button"; it is still the ticket's link.
        role="link"
        to="/p/$projectId/t/$ticketRef"
        params={{ projectId, ticketRef: t.key }}
        style={style}
        data-ticket={t.key}
        className={`block space-y-1 rounded-md border border-border bg-background p-2 text-sm hover:border-foreground/30 ${
          isDragging ? "relative z-10 shadow-lg" : ""
        }`}
      >
        <span className="block">
          <span className="text-muted-foreground">{t.key}</span> {t.title}
        </span>
        <span className="flex flex-wrap gap-1">
          {t.type && <Badge>{TYPE_LABELS[t.type]}</Badge>}
          {t.size && <Badge>{t.size}</Badge>}
          {t.dorStatus === "met" && <Badge variant="ok">DoR</Badge>}
          {t.needsAttention && <Badge variant="attention">needs you</Badge>}
          {t.archived && <Badge>archived</Badge>}
        </span>
      </Link>
      {error && <QueryError error={error} />}
    </div>
  );
}
