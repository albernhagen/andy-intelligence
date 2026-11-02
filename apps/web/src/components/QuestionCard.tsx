import { useState } from "react";
import type { Question } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/api";
import { useAnswerQuestion } from "@/lib/queries";

/** An open question with its options and suggested answer; answered ones show the answer. */
export function QuestionCard({
  question,
  heading,
}: {
  question: Question;
  heading?: React.ReactNode;
}) {
  const [answer, setAnswer] = useState(question.suggestedAnswer ?? "");
  const submit = useAnswerQuestion();

  return (
    <article
      aria-label={`Question: ${question.text}`}
      className="space-y-2 rounded-md border border-border p-3"
    >
      {heading}
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium whitespace-pre-wrap">{question.text}</p>
        {question.urgency === "high" && <Badge variant="attention">urgent</Badge>}
      </div>
      {question.assumptions.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {question.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      {question.status === "open" ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) submit.mutate({ questionId: question.id, answer: answer.trim() });
          }}
        >
          {question.options.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Options">
              {question.options.map((o) => (
                <Button
                  key={o}
                  type="button"
                  size="sm"
                  variant={o === answer ? "default" : "outline"}
                  aria-pressed={o === answer}
                  onClick={() => setAnswer(o)}
                >
                  {o}
                  {o === question.suggestedAnswer && " (suggested)"}
                </Button>
              ))}
            </div>
          )}
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
