import { useState } from "react";
import type { Question } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { toast } from "@/components/ui/toast";
import { errorText } from "@/lib/api";
import { useAnswerQuestion } from "@/lib/queries";
import { QuestionContext, QuestionRecommendationLine, consequenceOf } from "./QuestionFormat";

/** The answers to offer as buttons: the suggested one first (even if refine left it out of the options). */
export function answerChoices(question: Pick<Question, "options" | "suggestedAnswer">): string[] {
  const { options, suggestedAnswer } = question;
  if (!suggestedAnswer) return options;
  return [suggestedAnswer, ...options.filter((o) => o !== suggestedAnswer)];
}

/** The keys `1`–`9` pick (shortcuts.ts); a choice past the ninth has none. */
const MAX_KEY = 9;

/**
 * One open question in the inbox, in the question format (AI-73): the question line, context,
 * options with their consequences, the recommendation. Older questions show the line and plain
 * option buttons. One click on a choice answers it; free text stays. `locked`
 * while any answer on its card is in flight, so two answers never race (AI-30 review).
 *
 * AI-371: each choice shows the key that focuses it, numbered across the picked ticket from
 * `firstKey`, and an answer confirms in a toast naming the ticket. The API can't withdraw an
 * answer, so the toast has no Undo.
 */
export function InboxQuestion({
  question,
  locked,
  firstKey = 1,
  ticketLabel,
}: {
  question: Question;
  locked: boolean;
  /** The key of this question's first choice. */
  firstKey?: number;
  /** "OPS-2: Rotate the deploy key", for the toast. */
  ticketLabel: string;
}) {
  const [text, setText] = useState("");
  const submit = useAnswerQuestion(question.ticketId);
  const answer = (value: string) =>
    submit.mutate(
      { questionId: question.id, answer: value },
      { onSuccess: () => toast({ title: `Answered ${ticketLabel}`, description: value }) },
    );
  const choices = answerChoices(question);
  const mark = question.recommendation ? "Recommended" : "Suggested";
  // Older questions keep their layout: assumptions right under the line (AI-73: render as today).
  const formatted = Boolean(question.context);
  const assumptions = question.assumptions.length > 0 && (
    <ul aria-label="Assumptions" className="list-disc pl-5 text-xs text-muted-foreground">
      {question.assumptions.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  );
  const choiceButton = (choice: string, index: number) => {
    const key = firstKey + index;
    const suggested = choice === question.suggestedAnswer;
    return (
      <Button
        key={choice}
        type="button"
        size="sm"
        variant="outline"
        className={suggested ? "h-11 border-selected-edge bg-selected sm:h-8" : "h-11 sm:h-8"}
        disabled={locked}
        data-nav-choice
        aria-keyshortcuts={key <= MAX_KEY ? String(key) : undefined}
        onClick={() => answer(choice)}
      >
        {key <= MAX_KEY && <Kbd className="text-muted-foreground">{key}</Kbd>}
        {choice}
        {suggested && <Badge variant="success">{mark}</Badge>}
      </Button>
    );
  };

  return (
    // AI-371: j / k move between tickets in the list; this question's keys work from its row.
    <li aria-label={`Question: ${question.text}`} className="space-y-2 py-3">
      {/* The mark sits beside what it marks (AI-316). */}
      <div className="flex flex-wrap items-start gap-2">
        {question.urgency === "high" && <Badge variant="attention">Urgent</Badge>}
        <p className="text-md font-medium whitespace-pre-wrap">{question.text}</p>
      </div>
      {!formatted && assumptions}
      <QuestionContext question={question} />
      {question.choices.length > 0 ? (
        <ul aria-label="Answers" className="space-y-1">
          {choices.map((choice, i) => (
            <li key={choice} className="flex flex-wrap items-center gap-2">
              {choiceButton(choice, i)}
              <span className="text-sm text-muted-foreground">
                {consequenceOf(question, choice)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        choices.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Answers">
            {choices.map((choice, i) => choiceButton(choice, i))}
          </div>
        )
      )}
      <QuestionRecommendationLine question={question} />
      {formatted && assumptions}
      <form
        className="flex max-w-2xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) answer(text.trim());
        }}
      >
        <Input
          aria-label="Your answer"
          data-nav-answer
          name="answer"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Or type an answer"
          className="h-11 text-base sm:h-8 sm:text-sm"
        />
        {/* A per-row submit is outline: primary is the screen's one main action (design.md). */}
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-11 sm:h-8"
          disabled={!text.trim() || locked}
        >
          Answer
        </Button>
      </form>
      {submit.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(submit.error)}
        </p>
      )}
    </li>
  );
}
