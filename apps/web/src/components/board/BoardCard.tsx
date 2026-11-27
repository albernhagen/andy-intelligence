import { Link } from "@tanstack/react-router";
import { useSortable } from "@dnd-kit/sortable";
import {
  Bug,
  CircleDashed,
  FlaskConical,
  Lightbulb,
  Mountain,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { BoardTicket, Stage, Ticket, TicketType, Worker } from "@andy/contracts";
import { scoreMarkers, startScore } from "@andy/domain";
import { Badge } from "@/components/ui/badge";
import { DRAG_PREVIEW_CLASS, MOVE_TRANSITION } from "@/components/DragPreview";
import { QueryError } from "@/components/Status";
import { WorkerBadges } from "@/components/WorkerControls";
import { plural, runLabel } from "@/lib/board";
import { workerStatus } from "@/lib/needs-you";
import { typeLabel } from "@/lib/tickets";

export const TYPE_ICONS: Record<TicketType, LucideIcon> = {
  feature: Lightbulb,
  bug: Bug,
  chore: Wrench,
  epic: Mountain,
  spike: FlaskConical,
};

export { MOVE_TRANSITION };

const CARD_CLASS = "flex flex-col gap-1 rounded-lg border p-2 text-sm";

export interface CardProps {
  ticket: BoardTicket;
  projectId: string;
  /** Open blockers (not Done or Cancelled). */
  blockers: Ticket[];
  /** 1-based place in the Ready queue; null in other lanes. */
  position: number | null;
  next: boolean;
  now: number;
  error: Error | null;
}

/**
 * A compact card (apps/web/design.md "Status markers"): type and key, the title, then one line
 * of markers. The whole card is the ticket's link and the drag handle; a drop never follows the
 * link (AI-25, `useDropClickSuppression` in BoardPage).
 */
export function BoardCard({
  ticket: t,
  projectId,
  blockers,
  position,
  next,
  now,
  error,
}: CardProps) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: t.id,
    transition: MOVE_TRANSITION,
  });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };

  return (
    <li className="space-y-1">
      <Link
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        // dnd-kit's attributes make it a "button"; it is still the ticket's link.
        role="link"
        to="/p/$projectId/t/$ticketRef"
        params={{ projectId, ticketRef: t.key }}
        // Opening a ticket keeps the board's view (the Ready sort).
        search={true}
        style={style}
        data-ticket={t.key}
        data-nav-item
        data-dragging={isDragging || undefined}
        // While dragged, the card stays as a placeholder of its size: a dashed outline with its
        // text hidden but still read out; the copy under the pointer is BoardCardPreview.
        className={`${CARD_CLASS} focus-visible:outline-2 focus-visible:outline-ring ${
          isDragging
            ? "border-dashed border-foreground/30 bg-transparent [&>*]:opacity-0"
            : "border-border bg-raised hover:border-foreground/30"
        }`}
      >
        <CardBody ticket={t} blockers={blockers} position={position} next={next} now={now} />
        <span className="sr-only">{typeLabel(t.type)}</span>
      </Link>
      {error && <QueryError error={error} />}
    </li>
  );
}

type BodyProps = Pick<CardProps, "ticket" | "blockers" | "position" | "next" | "now">;

/** What a card shows, on the board and in its dragged copy. */
function CardBody({ ticket: t, blockers, position, next, now }: BodyProps) {
  const Icon = t.type ? TYPE_ICONS[t.type] : CircleDashed;
  const { openQuestions, run, pullRequest } = t.summary;
  return (
    <>
      <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
        {position !== null && (
          <>
            <span className="font-medium text-foreground" aria-label={`Position ${position}`}>
              {position}
            </span>
            <span aria-hidden>·</span>
          </>
        )}
        <span title={typeLabel(t.type)}>
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="font-mono">{t.key}</span>
        {next ? (
          <Badge variant="success" className="ml-auto">
            Next
          </Badge>
        ) : (
          t.type && (
            <span className="ml-auto" aria-hidden>
              {typeLabel(t.type)}
            </span>
          )
        )}
      </span>{" "}
      <span className="font-medium">{t.title}</span>
      <Markers
        ticket={t}
        openQuestions={openQuestions}
        needsAttention={t.needsAttention}
        run={run ? runLabel(run, now) : null}
        pullRequest={pullRequest}
        blockers={blockers}
        archived={t.archived}
        worker={t.summary.worker}
        stage={t.stage}
        type={t.type}
        sentBack={t.upNextRank === null ? t.sentBackReason : null}
      />
    </>
  );
}

/**
 * The copy of a card drawn under the pointer while it is dragged (AI-396): the card as it looks
 * on the board, lifted. Hidden from screen readers; dnd-kit announces the drag instead.
 */
export function BoardCardPreview(props: BodyProps) {
  return (
    <div aria-hidden data-drag-overlay className={`${CARD_CLASS} bg-raised ${DRAG_PREVIEW_CLASS}`}>
      <CardBody {...props} />
    </div>
  );
}

/** A card's marker line; the Work list (AI-198) shows the same markers. */
export function Markers({
  ticket,
  openQuestions,
  needsAttention,
  run,
  pullRequest,
  blockers,
  archived,
  sentBack,
  worker,
  stage,
  type,
}: {
  ticket: Ticket;
  openQuestions: number;
  needsAttention: boolean;
  run: string | null;
  pullRequest: BoardTicket["summary"]["pullRequest"];
  blockers: Pick<Ticket, "key">[];
  archived: boolean;
  sentBack: string | null;
  worker: Worker;
  stage: Stage;
  type: TicketType | null;
}) {
  const { mine, needsWorker } = workerStatus(worker, stage, type);
  const score = scoreMarkers(ticket);
  const label = startScore(ticket);
  const markers = [
    score.size && (
      <Badge key="size" title={label}>
        {score.size}
      </Badge>
    ),
    score.risk && (
      <Badge key="risk" title={label} variant={ticket.risk === "high" ? "danger" : "default"}>
        {score.risk}
      </Badge>
    ),
    score.confidence && (
      <Badge
        key="confidence"
        title={label}
        variant={ticket.confidence === "low" ? "attention" : "default"}
      >
        {score.confidence}
      </Badge>
    ),
    (mine || needsWorker) && (
      <WorkerBadges key="worker" worker={worker} stage={stage} type={type} />
    ),
    openQuestions > 0 ? (
      <Badge key="q" variant="attention">
        {plural(openQuestions, "question")}
      </Badge>
    ) : (
      needsAttention && (
        <Badge key="q" variant="attention">
          Needs you
        </Badge>
      )
    ),
    run && (
      <Badge key="run" variant="running">
        {run}
      </Badge>
    ),
    pullRequest && (
      <Badge
        key="pr"
        variant={
          pullRequest.state === "merged"
            ? "success"
            : pullRequest.state === "closed"
              ? "danger"
              : "default"
        }
      >
        PR #{pullRequest.number} · {pullRequest.state}
      </Badge>
    ),
    blockers.length > 0 && (
      <Badge key="blocked" variant="danger">
        Blocked by {blockers[0]!.key}
        {blockers.length > 1 && ` +${blockers.length - 1}`}
      </Badge>
    ),
    archived && <Badge key="archived">Archived</Badge>,
    sentBack && (
      <Badge key="sent-back" variant="attention" title={sentBack}>
        Sent back
      </Badge>
    ),
  ].filter(Boolean);
  return markers.length > 0 ? <span className="flex flex-wrap gap-1">{markers}</span> : null;
}
