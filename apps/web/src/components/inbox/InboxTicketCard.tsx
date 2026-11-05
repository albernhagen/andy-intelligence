import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { StageBadge, TypeMarker } from "@/components/TicketMarkers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/api";
import type { InboxCard } from "@/lib/needs-you";
import { useAnswerQuestion } from "@/lib/queries";
import { InboxQuestion } from "./InboxQuestion";

/**
 * One ticket in the inbox: type, key, title (linked) and stage, then its open questions, or why
 * it is flagged when it has none. "Accept all suggested" answers them one by one.
 */
export function InboxTicketCard({ card }: { card: InboxCard }) {
  const { ticket } = card;
  const label = ticket ? `${ticket.key}: ${ticket.title}` : "Ticket";
  return (
    <article aria-label={label} className="space-y-1 rounded-md border border-border p-2">
      <header className="flex flex-wrap items-center gap-2">
        {ticket && <TypeMarker type={ticket.type} />}
        <Link
          to="/p/$projectId/t/$ticketRef"
          params={{ projectId: card.projectId, ticketRef: ticket?.key ?? card.ticketId }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {ticket ? (
            <>
              <span className="text-xs text-muted-foreground tabular-nums">{ticket.key}:</span>{" "}
              {ticket.title}
            </>
          ) : (
            "Open ticket"
          )}
        </Link>
        {ticket && <StageBadge stage={ticket.stage} archived={ticket.archived} />}
        <AcceptAllSuggested card={card} />
      </header>
      {card.questions.length > 0 ? (
        <ul className="divide-y divide-border">
          {card.questions.map((q) => (
            <InboxQuestion key={q.id} question={q} />
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 py-1 text-muted-foreground">
          <Badge variant="attention">Needs you</Badge>
          Flagged for you; open the ticket to see what it waits for.
        </p>
      )}
    </article>
  );
}

/** Answers every question on the card that has a suggestion, in order; stops at the first error. */
function AcceptAllSuggested({ card }: { card: InboxCard }) {
  const answer = useAnswerQuestion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const suggested = card.questions.filter((q) => q.suggestedAnswer);
  if (suggested.length === 0) return null;

  async function acceptAll() {
    setBusy(true);
    setError(null);
    try {
      for (const q of suggested) {
        await answer.mutateAsync({ questionId: q.id, answer: q.suggestedAnswer ?? "" });
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="ml-auto"
        disabled={busy}
        onClick={acceptAll}
      >
        Accept all suggested ({suggested.length})
      </Button>
      {error !== null && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {errorText(error)}
        </p>
      )}
    </>
  );
}
