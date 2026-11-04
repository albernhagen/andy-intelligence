import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Ticket } from "@andy/contracts";
import { AskQuestionForm } from "@/components/AskQuestionForm";
import { History } from "@/components/History";
import { MoveControls } from "@/components/MoveControls";
import { QuestionCard } from "@/components/QuestionCard";
import { Runs } from "@/components/Runs";
import { Loading, QueryError } from "@/components/Status";
import { TicketForm } from "@/components/TicketForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  useEvents,
  useReadiness,
  ticketQueryKey,
  useTicketByRef,
  useTicketQuestions,
  useUpdateTicket,
} from "@/lib/queries";
import { STAGE_LABELS } from "@/lib/tickets";

/**
 * Ticket detail: fields (view/edit), Definition of Ready, moves, agent runs, questions and
 * history. The URL holds the ticket key (`/p/ai/t/AI-2`); an older id link loads the ticket and
 * swaps in the key URL.
 */
export function TicketPage() {
  const { projectId, ticketRef } = useParams({ from: "/p/$projectId/t/$ticketRef" });
  const ticket = useTicketByRef(projectId, ticketRef);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const loaded = ticket.data;
  const key = loaded?.key;

  useEffect(() => {
    if (loaded && key && key !== ticketRef) {
      // Seed the key URL's query, so the swap shows no loading state.
      queryClient.setQueryData(ticketQueryKey(projectId, key), loaded);
      void navigate({
        to: "/p/$projectId/t/$ticketRef",
        params: { projectId, ticketRef: key },
        replace: true,
      });
    }
  }, [loaded, key, ticketRef, projectId, navigate, queryClient]);

  if (ticket.isPending) return <Loading />;
  if (ticket.isError) return <QueryError error={ticket.error} />;
  const t = ticket.data;
  const path = { projectId: t.projectId, ticketId: t.id };

  return (
    <article className="space-y-6">
      <Link
        to="/p/$projectId"
        params={{ projectId: path.projectId }}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Tickets
      </Link>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">
          {t.key}: {t.title}
        </h2>
        <Badge>{STAGE_LABELS[t.stage]}</Badge>
        <Badge>{t.type}</Badge>
        {t.needsYou && <Badge variant="attention">needs you</Badge>}
        {!editing && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </header>

      {editing ? (
        <EditTicket ticket={t} onDone={() => setEditing(false)} />
      ) : (
        <TicketFields ticket={t} />
      )}
      <Readiness projectId={path.projectId} ticketId={path.ticketId} />
      <MoveControls ticket={t} />
      <Runs projectId={path.projectId} ticketId={path.ticketId} />
      <Questions projectId={path.projectId} ticketId={path.ticketId} />
      <Events projectId={path.projectId} ticketId={path.ticketId} />
    </article>
  );
}

function EditTicket({ ticket, onDone }: { ticket: Ticket; onDone: () => void }) {
  const update = useUpdateTicket({ projectId: ticket.projectId, ticketId: ticket.id });
  const conflict = update.error instanceof ApiError && update.error.status === 409;
  return (
    <TicketForm
      ticket={ticket}
      submitLabel="Save"
      pending={update.isPending}
      error={
        update.error && (
          <div>
            <QueryError error={update.error} />
            {conflict && (
              <p className="text-sm text-muted-foreground">
                The ticket changed since you opened it. Cancel to see the latest, then edit again.
              </p>
            )}
          </div>
        )
      }
      onCancel={onDone}
      onSubmit={({ type: _type, ...fields }) =>
        update.mutate({ ...fields, ifUpdatedAt: ticket.updatedAt }, { onSuccess: onDone })
      }
    />
  );
}

function TicketFields({ ticket }: { ticket: Ticket }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[12rem_1fr]">
      <dt className="text-muted-foreground">Problem / intent</dt>
      <dd className="whitespace-pre-wrap">{ticket.body || "—"}</dd>
      <dt className="text-muted-foreground">Acceptance criteria</dt>
      <dd>
        <List items={ticket.acceptanceCriteria} />
      </dd>
      <dt className="text-muted-foreground">Assumptions</dt>
      <dd>
        <List items={ticket.assumptions} />
      </dd>
      <dt className="text-muted-foreground">Size</dt>
      <dd>
        {ticket.size ?? "—"}
        {ticket.sizeReason && ` (${ticket.sizeReason})`}
      </dd>
      <dt className="text-muted-foreground">Tier</dt>
      <dd>{ticket.tier ?? "—"}</dd>
    </dl>
  );
}

function List({ items }: { items: string[] }) {
  if (items.length === 0) return <>—</>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((i, n) => (
        <li key={n}>{i}</li>
      ))}
    </ul>
  );
}

type TicketPath = { projectId: string; ticketId: string };

function Readiness(path: TicketPath) {
  const dor = useReadiness(path);
  return (
    <section aria-label="Definition of Ready" className="space-y-1">
      <h3 className="text-sm font-medium">Definition of Ready</h3>
      {dor.isPending && <Loading />}
      {dor.isError && <QueryError error={dor.error} />}
      {dor.data?.met && <p className="text-sm">Met.</p>}
      {dor.data && !dor.data.met && (
        <>
          <p className="text-sm text-muted-foreground">Not met. Missing:</p>
          <List items={dor.data.missing} />
        </>
      )}
    </section>
  );
}

function Questions(path: TicketPath) {
  const questions = useTicketQuestions(path);
  return (
    <section aria-label="Questions" className="space-y-2">
      <h3 className="text-sm font-medium">Questions</h3>
      {questions.isPending && <Loading />}
      {questions.isError && <QueryError error={questions.error} />}
      {questions.data?.map((q) => (
        <QuestionCard key={q.id} question={q} />
      ))}
      <AskQuestionForm {...path} />
    </section>
  );
}

function Events(path: TicketPath) {
  const events = useEvents(path);
  if (events.isPending) return <Loading />;
  if (events.isError) return <QueryError error={events.error} />;
  return <History {...path} events={events.data} />;
}
