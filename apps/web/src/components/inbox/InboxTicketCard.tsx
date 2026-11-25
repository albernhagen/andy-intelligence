import { useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Question } from "@andy/contracts";
import { StageBadge, TypeMarker } from "@/components/TicketMarkers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { toast } from "@/components/ui/toast";
import { errorText } from "@/lib/api";
import type { InboxCard } from "@/lib/needs-you";
import { answerKey, useAnswerQuestion } from "@/lib/queries";
import { answerChoices, InboxQuestion } from "./InboxQuestion";

/** Each question's first key: choices are numbered on from the question before. */
function firstKeys(questions: Question[]): number[] {
  const keys: number[] = [];
  let next = 1;
  for (const q of questions) {
    keys.push(next);
    next += answerChoices(q).length;
  }
  return keys;
}

/**
 * The picked ticket in the inbox (AI-371: the detail beside the list): where it sits, its title,
 * then its open questions, or why it is flagged when it has none. Each choice shows the key that
 * focuses it, numbered across the ticket. "Accept all suggested" is the screen's one primary
 * action, in the footer. `only` shows just the first question (the phone's one decision).
 */
export function InboxTicketCard({
  card,
  projectName,
  only,
}: {
  card: InboxCard;
  /** "Ops", shown first in the location line. */
  projectName?: string;
  only?: boolean;
}) {
  const { ticket } = card;
  // One lock per card: a single answer or "Accept all suggested", never both at once.
  const answering = useIsMutating({ mutationKey: answerKey(card.ticketId) }) > 0;
  const [acceptingAll, setAcceptingAll] = useState(false);
  const locked = answering || acceptingAll;
  const label = ticket ? `${ticket.key}: ${ticket.title}` : "Ticket";
  const questions = only ? card.questions.slice(0, 1) : card.questions;
  const keys = firstKeys(questions);
  return (
    <article aria-label={label} className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {projectName && <span>{projectName}</span>}
        {ticket && <TypeMarker type={ticket.type} />}
        {ticket && <span className="font-mono text-xs tabular-nums">{ticket.key}</span>}
        {ticket && <StageBadge stage={ticket.stage} archived={ticket.archived} />}
        <Link
          to="/p/$projectId/t/$ticketRef"
          params={{ projectId: card.projectId, ticketRef: ticket?.key ?? card.ticketId }}
          data-nav-open
          className="ml-auto inline-flex items-center text-foreground underline-offset-2 hover:underline max-sm:min-h-11"
        >
          Open ticket
        </Link>
      </header>
      {ticket && <h3 className="mt-3 text-lg font-semibold">{ticket.title}</h3>}
      {questions.length > 0 ? (
        <ul className="mt-1 flex-1 divide-y divide-border">
          {questions.map((q, i) => (
            <InboxQuestion
              key={q.id}
              question={q}
              locked={locked}
              firstKey={keys[i]}
              ticketLabel={label}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 flex flex-1 items-start gap-2 text-muted-foreground">
          <Badge variant="attention">Needs you</Badge>
          Flagged for you; open the ticket to see what it waits for.
        </p>
      )}
      <footer className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <p className="flex items-center gap-1 text-xs text-muted-foreground max-sm:hidden">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> move · <Kbd>1</Kbd>–<Kbd>9</Kbd> pick · <Kbd>Enter</Kbd> choose
        </p>
        <AcceptAllSuggested
          card={card}
          questions={questions}
          label={label}
          locked={locked}
          onBusy={setAcceptingAll}
        />
      </footer>
    </article>
  );
}

/** Answers every shown question that has a suggestion, in order; stops at the first error. */
function AcceptAllSuggested(props: {
  card: InboxCard;
  questions: Question[];
  label: string;
  locked: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const { card, questions, label, locked, onBusy } = props;
  const answer = useAnswerQuestion(card.ticketId);
  const [error, setError] = useState<unknown>(null);
  const suggested = questions.filter((q) => q.suggestedAnswer);
  if (suggested.length === 0) return null;

  async function acceptAll() {
    onBusy(true);
    setError(null);
    let done = 0;
    try {
      for (const q of suggested) {
        await answer.mutateAsync({ questionId: q.id, answer: q.suggestedAnswer ?? "" });
        done++;
      }
    } catch (e) {
      setError(e);
    } finally {
      onBusy(false);
      // The API can't withdraw an answer, so no Undo (AI-371).
      if (done > 0)
        toast({
          title: `Answered ${label}`,
          description: `${done} suggested ${done === 1 ? "answer" : "answers"} accepted`,
        });
    }
  }

  return (
    <>
      {error !== null && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {errorText(error)}
        </p>
      )}
      {/* The screen's one primary action (design.md). */}
      <Button
        type="button"
        size="sm"
        className="ml-auto h-11 max-sm:w-full sm:h-8"
        disabled={locked}
        onClick={acceptAll}
      >
        Accept all suggested ({suggested.length})
      </Button>
    </>
  );
}
