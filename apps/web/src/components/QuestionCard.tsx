import { useState } from "react";
import type { Question } from "@andy/contracts";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/api";
import { useAnswerQuestion } from "@/lib/queries";
import {
  QuestionContext,
  QuestionRecommendationLine,
  consequenceOf,
} from "@/components/inbox/QuestionFormat";

/**
 * An open question with its options and suggested answer; answered ones show the answer. In the
 * question format (AI-73) the line is followed by context, options with consequences and the
 * recommendation; older questions render as before. The text is untrusted (often agent-written):
 * safe markdown only (`Markdown`), the rest plain text.
 */
export function QuestionCard({
  question,
  heading,
}: {
  question: Question;
  heading?: React.ReactNode;
}) {
  const [answer, setAnswer] = useState(question.suggestedAnswer ?? "");
  const submit = useAnswerQuestion();
  const formatted = question.context !== null;
  const assumptions = question.assumptions.length > 0 && (
    <ul className="list-disc pl-5 text-sm text-muted-foreground">
      {question.assumptions.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  );
  const option = (o: string) => (
    <Button
      key={o}
      type="button"
      size="sm"
      variant={o === answer ? "default" : "outline"}
      aria-pressed={o === answer}
      onClick={() => setAnswer(o)}
    >
      {o}
      {o === question.suggestedAnswer && (formatted ? " (recommended)" : " (suggested)")}
    </Button>
  );

  return (
    <article
      aria-label={`Question: ${question.text}`}
      className="space-y-2 rounded-md border border-border p-3"
    >
      {heading}
      <div className="flex items-start justify-between gap-2">
        <Markdown className="font-medium">{question.text}</Markdown>
        {question.urgency === "high" && <Badge variant="attention">urgent</Badge>}
      </div>
      {!formatted && assumptions}
      <QuestionContext question={question} />

      {question.status === "open" ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) submit.mutate({ questionId: question.id, answer: answer.trim() });
          }}
        >
          {question.choices.length > 0 ? (
            <ul aria-label="Options" className="space-y-1">
              {question.options.map((o) => (
                <li key={o} className="flex flex-wrap items-center gap-2">
                  {option(o)}
                  <span className="text-sm text-muted-foreground">
                    {consequenceOf(question, o)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            question.options.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Options">
                {question.options.map(option)}
              </div>
            )
          )}
          <QuestionRecommendationLine question={question} />
          {formatted && assumptions}
          <div className="flex gap-2">
            <Input
              aria-label="Answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your answer"
            />
            <Button type="submit" disabled={!answer.trim() || submit.isPending}>
              Answer
            </Button>
          </div>
          {submit.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(submit.error)}
            </p>
          )}
        </form>
      ) : (
        <p className="text-sm">
          <span className="text-muted-foreground">
            {question.status === "answered" ? `Answered via ${question.answeredVia}:` : "Withdrawn"}
          </span>{" "}
          {question.answer}
        </p>
      )}
    </article>
  );
}
