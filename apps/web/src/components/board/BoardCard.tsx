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
import { QueryError } from "@/components/Status";
import { WorkerBadges } from "@/components/WorkerControls";
import { plural, runLabel } from "@/lib/board";
import { workerStatus } from "@/lib/needs-you";
import { typeLabel } from "@/lib/tickets";

const TYPE_ICONS: Record<TicketType, LucideIcon> = {
  feature: Lightbulb,
  bug: Bug,
  chore: Wrench,
  epic: Mountain,
  spike: FlaskConical,
};

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
  });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };
  const Icon = t.type ? TYPE_ICONS[t.type] : CircleDashed;
  const { openQuestions, run, pullRequest } = t.summary;

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
        className={`flex flex-col gap-1 rounded-md border border-border bg-background p-2 text-sm hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-ring ${
          isDragging ? "relative z-10 shadow-lg" : ""
        }`}
      >
        <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          {position !== null && (
            <span className="font-medium text-foreground" aria-label={`Position ${position}`}>
              {position}
            </span>
          )}
          <span title={typeLabel(t.type)}>
            <Icon className="size-3.5" aria-hidden />
          </span>
          <span>{t.key}</span>
          {next && (
            <Badge variant="success" className="ml-auto">
              Next
            </Badge>
          )}
        </span>{" "}
        <span>{t.title}</span>
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
        <span className="sr-only">{typeLabel(t.type)}</span>
      </Link>
      {error && <QueryError error={error} />}
    </li>
  );
}

function Markers({
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
  blockers: Ticket[];
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
