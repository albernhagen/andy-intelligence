import { z } from "zod";
import { Id, Timestamp } from "./common";

/**
 * Onboarding a managed repo (AI-381): every step of runbook `managed-project.md`, as the setup
 * path shows it. The rules that decide each step live in `@andy/domain` (`onboarding.ts`); the
 * API reads the facts through the `CodeHost` port. Nothing here runs a step or holds a token.
 */

/** The runbook's steps, in its order. */
export const OnboardingStepKey = z.enum([
  "repo_app",
  "baseline_pr",
  "repo_settings",
  "reusable_workflows",
  "reviewer_token",
  "agent_environment",
  "proving_refine",
  "builds_on",
]);
export type OnboardingStepKey = z.infer<typeof OnboardingStepKey>;

/**
 * Steps Andy may mark done by hand: those done in GitHub or the terminal. A mark counts for a
 * step the app can't read (`hand`), after the live part of a `both` step, and for a live step
 * only while its read fails (`unknown`). The last two steps read the app's own data: no mark.
 */
export const MarkableStepKey = z.enum([
  "repo_app",
  "baseline_pr",
  "repo_settings",
  "reusable_workflows",
  "reviewer_token",
  "agent_environment",
]);
export type MarkableStepKey = z.infer<typeof MarkableStepKey>;

/** Who marked a step done by hand, and when (the signed-in email, set by the domain). */
export const OnboardingMark = z.object({
  by: z.string().max(320),
  at: Timestamp,
});
export type OnboardingMark = z.infer<typeof OnboardingMark>;

export const OnboardingMarks = z.partialRecord(MarkableStepKey, OnboardingMark);
export type OnboardingMarks = z.infer<typeof OnboardingMarks>;

/** Spread into `Project`: projects stored before it read as no marks, unrewritten. */
export const projectOnboardingFields = {
  setupMarks: OnboardingMarks.default({}),
};

/** Spread into `ProjectPatch` (storage only; never in ProjectSettings: the domain sets it). */
export const projectOnboardingPatch = {
  setupMarks: OnboardingMarks.optional(),
};

/** A step's result: read live, or `unknown` when the read failed or isn't possible yet. */
export const OnboardingStatus = z.enum(["done", "not_yet", "unknown"]);
export type OnboardingStatus = z.infer<typeof OnboardingStatus>;

/** `live`: read by the app; `hand`: Andy marks it; `both`: a live part, then a mark. */
export const OnboardingHow = z.enum(["live", "hand", "both"]);
export type OnboardingHow = z.infer<typeof OnboardingHow>;

export const OnboardingCheck = z.object({
  label: z.string(),
  status: OnboardingStatus,
  /** What is left, or why it couldn't be read; null when done. */
  detail: z.string().nullable(),
});
export type OnboardingCheck = z.infer<typeof OnboardingCheck>;

export const OnboardingCommand = z.object({
  /** What the command does, e.g. "Preview the settings". */
  label: z.string(),
  text: z.string(),
});
export type OnboardingCommand = z.infer<typeof OnboardingCommand>;

export const OnboardingStep = z.object({
  key: OnboardingStepKey,
  label: z.string(),
  /** What to do, in one line. */
  instruction: z.string(),
  commands: z.array(OnboardingCommand),
  /** Where the step is done, e.g. the repo's settings page; null when nowhere outside the app. */
  link: z.object({ label: z.string(), url: z.url() }).nullable(),
  how: OnboardingHow,
  checks: z.array(OnboardingCheck),
  /** Set when Andy marked the step done by hand. */
  marked: OnboardingMark.nullable(),
  status: OnboardingStatus,
});
export type OnboardingStep = z.infer<typeof OnboardingStep>;

export const RepoLimitKey = z.enum(["public", "main", "pnpm_lock", "nvmrc", "one_repo"]);
export type RepoLimitKey = z.infer<typeof RepoLimitKey>;

export const RepoLimit = z.object({
  key: RepoLimitKey,
  label: z.string(),
  status: z.enum(["ok", "fails", "unknown"]),
  detail: z.string().nullable(),
});
export type RepoLimit = z.infer<typeof RepoLimit>;

/** The proving refine (runbook step 8): the newest refine agent task in the project. */
export const ProvingRefine = z.object({
  /** The task, or null when none has run yet. */
  runId: Id.nullable(),
  ticketKey: z.string().nullable(),
  status: z.enum(["none", "running", "succeeded", "failed"]),
  /** The executor's run page, where the agent job's environment shows. */
  url: z.url().nullable(),
  error: z.string().nullable(),
  /** A Backlog ticket in Up next a refine can start on now; null when there is none. */
  candidate: z.object({ id: Id, key: z.string(), title: z.string() }).nullable(),
});
export type ProvingRefine = z.infer<typeof ProvingRefine>;

export const Onboarding = z.object({
  repo: z.string().nullable(),
  limits: z.array(RepoLimit),
  steps: z.array(OnboardingStep),
  refine: ProvingRefine,
  /** Every step done. */
  complete: z.boolean(),
  /** When the code host was read (answers are cached, ADR-0028). */
  readAt: Timestamp,
});
export type Onboarding = z.infer<typeof Onboarding>;

export const MarkStepBody = z.object({ step: MarkableStepKey, done: z.boolean() });
export type MarkStepBody = z.infer<typeof MarkStepBody>;
