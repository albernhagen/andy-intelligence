import { z } from "zod";
import { QUESTION_FORMAT_LIMITS, questionLine } from "./question-format";

/**
 * Ideation (AI-114, ADR-0050): the ideate procedure's result. `platform/procedures/ideate.schema.json`
 * is the agent's copy; this schema is the check, including what the JSON Schema can't say: an
 * `epic` outcome has an epic and a spec and no question, a `question` outcome exactly one
 * question and neither. Every field is untrusted text.
 */

export const IDEATE_LIMITS = {
  idea: 4000,
  summary: 4000,
  title: 100,
  body: 4000,
  criteria: 10,
  criterion: 500,
  slices: 10,
  sliceTitle: 200,
  sliceSummary: 300,
  specPath: 120,
  specMarkdown: 8000,
  question: 500,
  options: 5,
} as const;

const text = (max: number) => z.string().trim().min(1).max(max);

export const IdeateEpic = z.strictObject({
  title: text(IDEATE_LIMITS.title),
  body: text(IDEATE_LIMITS.body),
  acceptanceCriteria: z.array(text(IDEATE_LIMITS.criterion)).min(1).max(IDEATE_LIMITS.criteria),
  slices: z
    .array(
      z.strictObject({
        title: text(IDEATE_LIMITS.sliceTitle),
        summary: text(IDEATE_LIMITS.sliceSummary),
      }),
    )
    .min(1)
    .max(IDEATE_LIMITS.slices),
});
export type IdeateEpic = z.infer<typeof IdeateEpic>;

/** Same pattern as the agent schema's `spec.path`. */
export const SPEC_PATH = /^specs\/[a-z0-9]+(-[a-z0-9]+)*\.md$/;

export const IdeateSpec = z.strictObject({
  path: z.string().max(IDEATE_LIMITS.specPath).regex(SPEC_PATH),
  markdown: text(IDEATE_LIMITS.specMarkdown),
});
export type IdeateSpec = z.infer<typeof IdeateSpec>;

export const IdeateQuestion = z
  .strictObject({
    question: questionLine(IDEATE_LIMITS.question),
    context: text(QUESTION_FORMAT_LIMITS.context),
    options: z
      .array(
        z.strictObject({
          label: text(QUESTION_FORMAT_LIMITS.label),
          consequence: text(QUESTION_FORMAT_LIMITS.consequence),
        }),
      )
      .min(2)
      .max(IDEATE_LIMITS.options),
    recommendation: z.strictObject({
      answer: text(QUESTION_FORMAT_LIMITS.label),
      reason: text(QUESTION_FORMAT_LIMITS.reason),
    }),
  })
  .refine((q) => q.options.some((o) => o.label === q.recommendation.answer), {
    path: ["recommendation", "answer"],
    message: "the recommended answer must equal one option's label",
  });
export type IdeateQuestion = z.infer<typeof IdeateQuestion>;

export const IdeateOutput = z
  .strictObject({
    summary: text(IDEATE_LIMITS.summary),
    outcome: z.enum(["epic", "question"]),
    epic: IdeateEpic.nullable(),
    spec: IdeateSpec.nullable(),
    questions: z.array(IdeateQuestion).max(1),
  })
  .superRefine((o, ctx) => {
    const fits =
      o.outcome === "epic"
        ? o.epic !== null && o.spec !== null && o.questions.length === 0
        : o.epic === null && o.spec === null && o.questions.length === 1;
    if (!fits) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message:
          "epic needs an epic and a spec and no question; question needs exactly one question and neither",
      });
    }
  });
export type IdeateOutput = z.infer<typeof IdeateOutput>;

/** What the owner submits: the idea in their words and the procedure's result for it. */
export const IdeateSubmission = z.strictObject({
  idea: text(IDEATE_LIMITS.idea),
  result: IdeateOutput,
});
export type IdeateSubmission = z.infer<typeof IdeateSubmission>;
