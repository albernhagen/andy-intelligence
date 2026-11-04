import { Link } from "@tanstack/react-router";
import type { Ticket } from "@andy/contracts";
import { QuestionCard } from "@/components/QuestionCard";
import { Loading, QueryError } from "@/components/Status";
import { useNeedsYou } from "@/lib/queries";
import { sortQuestions } from "@/lib/tickets";

/** Needs-you inbox, the home screen (ARCHITECTURE §7.5): open questions, then flagged tickets. */
export function InboxPage() {
  const needsYou = useNeedsYou();
  if (needsYou.isPending) return <Loading />;
  if (needsYou.isError) return <QueryError error={needsYou.error} />;

  const { questions, tickets } = needsYou.data;
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const withQuestions = new Set(questions.map((q) => q.ticketId));
  const otherFlagged = tickets.filter((t) => !withQuestions.has(t.id));

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-medium">Needs you</h2>
      {questions.length === 0 && otherFlagged.length === 0 && (
        <p className="text-muted-foreground">Nothing needs you.</p>
      )}

      {questions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Open questions</h3>
          {sortQuestions(questions).map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              heading={
                <TicketLink
                  projectId={q.projectId}
                  ticketId={q.ticketId}
                  ticket={byId.get(q.ticketId)}
                />
              }
            />
          ))}
        </div>
      )}

      {otherFlagged.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Flagged tickets</h3>
          <ul className="space-y-1">
            {otherFlagged.map((t) => (
              <li key={t.id}>
                <TicketLink projectId={t.projectId} ticketId={t.id} ticket={t} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function TicketLink(props: { projectId: string; ticketId: string; ticket: Ticket | undefined }) {
  return (
    <Link
      to="/p/$projectId/t/$ticketRef"
      params={{ projectId: props.projectId, ticketRef: props.ticket?.key ?? props.ticketId }}
      className="text-sm underline-offset-2 hover:underline"
    >
      {props.ticket ? `${props.ticket.key}: ${props.ticket.title}` : "Open ticket"}
    </Link>
  );
}
