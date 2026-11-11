import { z } from "zod";

/**
 * The question format (AI-73): a question Andy can answer without having read the ticket. The
 * question line itself is the question's `text`; these fields carry the rest. Stored questions
 * from before AI-73 lack them and read back with the defaults, so they render as before.
 */
export const QUESTION_FORMAT_LIMITS = {
  context: 800,
  label: 200,
  consequence: 300,
  reason: 300,
} as const;

export const QuestionChoice = z.object({
  /** The option as Andy would answer it. */
  label: z.string().min(1),
  /** What choosing it does or costs. */
  consequence: z.string().min(1),
});
export type QuestionChoice = z.infer<typeof QuestionChoice>;

export const QuestionRecommendation = z.object({
  /** The answer the asker would pick. */
  answer: z.string().min(1),
  /** Why, in one line. */
  reason: z.string().min(1),
});
export type QuestionRecommendation = z.infer<typeof QuestionRecommendation>;

/** Spread into the stored Question (and refine's Assumption, which can become one). */
export const questionFormatFields = {
  /** Two to four sentences: what the feature is, what happens today, why the answer is needed now. */
  context: z.string().nullable().default(null),
  /** Each option with its consequence; `options` keeps the labels for older readers. */
  choices: z.array(QuestionChoice).default([]),
  recommendation: QuestionRecommendation.nullable().default(null),
};

const capped = (max: number) => z.string().trim().min(1).max(max);

/** One plain sentence ending in a question mark; trailing spaces don't count. */
export const questionLine = (max: number) =>
  capped(max).refine((s) => s.endsWith("?"), {
    message: "the question must be one plain sentence ending in a question mark",
  });

/**
 * What refine writes for each gap (untrusted agent output, every field capped, ADR-0028). The
 * refine gate rejects a gap with no context or an option without a consequence (ADR-0054).
 */
export const refineQuestionFields = (maxOptions: number) => ({
  context: capped(QUESTION_FORMAT_LIMITS.context),
  options: z
    .array(
      z.strictObject({
        label: capped(QUESTION_FORMAT_LIMITS.label),
        consequence: capped(QUESTION_FORMAT_LIMITS.consequence),
      }),
    )
    .max(maxOptions)
    .default([]),
  recommendation: z.strictObject({
    answer: capped(QUESTION_FORMAT_LIMITS.label),
    reason: capped(QUESTION_FORMAT_LIMITS.reason),
  }),
});

/**
 * With options, the recommended answer is one of their labels exactly, so the one-click
 * "accept recommended" answers with an option; the why goes in `reason`. An open question
 * (no options) may recommend any answer.
 */
export function recommendationIsAnOption(
  gap: { options: { label: string }[]; recommendation: { answer: string } },
  ctx: z.RefinementCtx,
): void {
  if (gap.options.length === 0) return;
  if (gap.options.some((o) => o.label === gap.recommendation.answer)) return;
  ctx.addIssue({
    code: "custom",
    path: ["recommendation", "answer"],
    message: "the recommended answer must equal one option's label; put the why in reason",
  });
}
