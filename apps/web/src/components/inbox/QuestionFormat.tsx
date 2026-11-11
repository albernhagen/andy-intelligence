import type { Question } from "@andy/contracts";

type Formatted = Pick<Question, "context" | "choices" | "recommendation">;

/**
 * The question format (AI-73) after the question line: context, then each option with what it
 * does or costs. Questions stored before it have none of these and render nothing here. All of
 * it is agent-written data shown as plain text.
 */
export function QuestionContext({ question }: { question: Formatted }) {
  if (!question.context) return null;
  return (
    <p aria-label="Context" className="text-sm whitespace-pre-wrap text-muted-foreground">
      {question.context}
    </p>
  );
}

/** What choosing an option does, when the question says; undefined for older questions. */
export function consequenceOf(question: Formatted, label: string): string | undefined {
  return question.choices.find((c) => c.label === label)?.consequence;
}

/** "Recommended: X. Why." under the options; nothing for older questions. */
export function QuestionRecommendationLine({ question }: { question: Formatted }) {
  const { recommendation } = question;
  if (!recommendation) return null;
  return (
    <p aria-label="Recommendation" className="text-sm">
      <span className="font-medium">Recommended: {recommendation.answer}.</span>{" "}
      <span className="text-muted-foreground">{recommendation.reason}</span>
    </p>
  );
}
