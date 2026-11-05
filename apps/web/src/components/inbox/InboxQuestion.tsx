import { useState } from "react";
import type { Question } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/api";
import { useAnswerQuestion } from "@/lib/queries";

/** The answers to offer as buttons: the suggested one first (even if refine left it out of the options). */
export function answerChoices(question: Pick<Question, "options" | "suggestedAnswer">): string[] {
  const { options, suggestedAnswer } = question;
  if (!suggestedAnswer) return options;
  return [suggestedAnswer, ...options.filter((o) => o !== suggestedAnswer)];
}

/**
 * One open question in the inbox: one click on a choice answers it; free text stays. `locked`
 * while any answer on its card is in flight, so two answers never race (AI-30 review).
 */
export function InboxQuestion({ question, locked }: { question: Question; locked: boolean }) {
  const [text, setText] = useState("");
  const submit = useAnswerQuestion(question.ticketId);
  const answer = (value: string) => submit.mutate({ questionId: question.id, answer: value });

  return (
    <li aria-label={`Question: ${question.text}`} className="space-y-2 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="whitespace-pre-wrap">{question.text}</p>
        {question.urgency === "high" && <Badge variant="attention">Urgent</Badge>}
      </div>
      {question.assumptions.length > 0 && (
        <ul aria-label="Assumptions" className="list-disc pl-5 text-xs text-muted-foreground">
          {question.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {answerChoices(question).length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Answers">
          {answerChoices(question).map((choice) => (
            <Button
              key={choice}
              type="button"
              size="sm"
              variant="outline"
              disabled={locked}
              onClick={() => answer(choice)}
            >
              {choice}
              {choice === question.suggestedAnswer && <Badge variant="success">Suggested</Badge>}
            </Button>
          ))}
        </div>
      )}
      <form
        className="flex max-w-2xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) answer(text.trim());
        }}
      >
        <Input
          aria-label="Your answer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Or type an answer"
          className="h-8"
        />
        <Button type="submit" size="sm" disabled={!text.trim() || locked}>
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
