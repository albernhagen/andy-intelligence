import { z } from "zod";
import { Worker } from "./worker";
import { ExecutorKind } from "./executor";
import {
  Actor,
  HarnessKey,
  Id,
  PolicyScope,
  ProviderKey,
  Route,
  RunStep,
  Size,
  Stage,
  TicketType,
  TierKey,
  Timestamp,
  Urgency,
} from "./common";
import { projectDispatchFields } from "./dispatch-caps";
import { projectNotifyFields } from "./notify-email";
import { projectPlanFields } from "./project-plan";
import { configChangeProposalFields } from "./config-proposals";

export * from "./common";
export * from "./dispatch-caps";
import { RunCostFields } from "./cost";
import { runInFlightFields } from "./in-flight";
import { runSyncFields } from "./sync";
import { runLocalFields } from "./runner";
import { RefineScores, TicketScores } from "./scores";
import {
  questionFormatFields,
  questionLine,
  recommendationIsAnOption,
  refineQuestionFields,
} from "./question-format";

export * from "./common";
export * from "./cost";
export * from "./dashboard";
export * from "./in-flight";
export * from "./sync";
export * from "./scores";
export * from "./notify-email";
export * from "./question-format";
export * from "./brief";
export * from "./project-plan";

/** ARCHITECTURE §5 — domain model. Vendor concepts must not appear here. */

export const AutonomyLevel = z.enum(["autonomous", "gated", "manual"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

/**
 * Which tickets need Andy's approval of a read-only plan before their build (ADR-0050): none,
 * M and L tickets, or all. Default `none`.
 */
export const PlanApproval = z.enum(["none", "m-and-l", "all"]);
export type PlanApproval = z.infer<typeof PlanApproval>;

/**
 * Which tickets' agent PRs the control plane merges on its own when the gate passes (ADR-0050):
 * none, S, S and M, or all. The gate's vetoes apply under every policy.
 */
export const AutoMerge = z.enum(["none", "s", "s-and-m", "all"]);
export type AutoMerge = z.infer<typeof AutoMerge>;

export const Project = z.object({
  id: Id,
  name: z.string().min(1),
  repos: z.array(z.string().min(1)),
  /** Ticket key prefix, e.g. "AI". */
  key: z.string().regex(/^[A-Z][A-Z0-9]{0,9}$/),
  gcpDevProjectId: z.string().nullable(),
  gcpProdProjectId: z.string().nullable(),
  autonomy: AutonomyLevel,
  monthlyBudgetUsd: z.number().nonnegative().nullable(),
  enabled: z.boolean(),
  /** Refine starts on its own for tickets entering Up next and answered ones (ADR-0075); default on. */
  autoRefine: z.boolean().default(true),
  /**
   * The build dispatcher takes Ready tickets on its own, top of the order first (ADR-0063);
   * default off: Andy turns it on per project.
   */
  autoBuild: z.boolean().default(false),
  /**
   * Build runs may start at all, by hand or by the dispatcher (ADR-0063). Off until Andy turns
   * it on after the live sandbox proof (runbook `agent-runs.md` §9); who and when are recorded.
   */
  buildEnabled: z.boolean().default(false),
  buildEnabledBy: z.string().max(320).nullable().default(null),
  buildEnabledAt: Timestamp.nullable().default(null),
  /** Builds of these tickets wait for Andy to approve a plan run first (ADR-0050). */
  planApproval: PlanApproval.default("none"),
  /** Refine questions the project takes per rolling 24 hours; extras become assumptions (ADR-0075). */
  dailyQuestionCap: z.number().int().min(0).max(50).default(5),
  /**
   * New projects are created with `s-and-m` (ADR-0050). This default only covers documents older
   * than the field, such as project AI, which stays `none` until M2: Self-hosting.
   */
  autoMerge: AutoMerge.default("none"),
  ...projectDispatchFields,
  ...projectNotifyFields,
  ...projectPlanFields,
  /** Who does a ticket's work when it has no pick of its own (ADR-0082). */
  defaultWorker: Worker.default("agent"),
  /** Where a ticket's runs execute when it has no pick of its own (ADR-0089). */
  executor: ExecutorKind.default("actions"),
});
export type Project = z.infer<typeof Project>;

export const TicketOverrides = z.object({
  assignee: z.union([z.literal("me"), z.literal("agent"), HarnessKey]).optional(),
  tier: TierKey.optional(),
  modelPin: Route.optional(),
  autonomy: AutonomyLevel.optional(),
  targetEnv: z.enum(["dev", "prod"]).optional(),
  /** Where this ticket's runs execute; absent follows the project's `executor` (ADR-0089). */
  executor: ExecutorKind.optional(),
});
export type TicketOverrides = z.infer<typeof TicketOverrides>;

export const DorStatus = z.enum(["not_met", "met"]);
export type DorStatus = z.infer<typeof DorStatus>;

/** e.g. "AI-42": project key + per-project number. */
export const TicketKey = z.string().regex(/^[A-Z][A-Z0-9]{0,9}-\d+$/);
export type TicketKey = z.infer<typeof TicketKey>;

/** Caps on the scope lists (ADR-0028): refine drafts them, so they are untrusted agent text. */
export const SCOPE_LIMITS = { maxItems: 20, item: 300 } as const;
export const ScopeList = z
  .array(z.string().trim().min(1).max(SCOPE_LIMITS.item))
  .max(SCOPE_LIMITS.maxItems);

const REFINE_REASON_MAX = 300;

/** What a wrong guess would cost (ADR-0075). Anything but `reversible` is worth asking Andy. */
export const GapCost = z.enum(["reversible", "direction", "scope", "trust", "spend"]);
export type GapCost = z.infer<typeof GapCost>;

export const GapConfidence = z.enum(["sure", "unsure"]);
export type GapConfidence = z.infer<typeof GapConfidence>;

/**
 * `assumed`: refine's default stands. `promoted`: Andy turned it into a question. `answered`: he
 * answered it and that gap waits for a re-refine. `settled`: the re-refine ran (ADR-0075).
 * `accepted`: Andy let a held gap stand as an assumption (AI-75, ADR-0087).
 */
export const AssumptionStatus = z.enum(["assumed", "promoted", "answered", "settled", "accepted"]);
export type AssumptionStatus = z.infer<typeof AssumptionStatus>;

/** A gap refine decided by itself, visible and reversible (ADR-0075). Untrusted agent text. */
export const Assumption = z.object({
  /** `<runId>-a<n>`: writing the same run's assumptions twice hits the same ids. */
  id: Id,
  /** What refine assumed. */
  text: z.string().min(1),
  /** The decision behind it, phrased as the question it becomes if promoted. */
  question: z.string().min(1),
  options: z.array(z.string()).default([]),
  cost: GapCost,
  confidence: GapConfidence,
  /** Set when a cap turned what should have been a question into this assumption. */
  demotedBy: z.enum(["ticket_cap", "daily_cap"]).nullable().default(null),
  runId: Id,
  status: AssumptionStatus.default("assumed"),
  questionId: Id.nullable().default(null),
  answeredAt: Timestamp.nullable().default(null),
  /** The re-refine run that covered this gap. */
  settledBy: Id.nullable().default(null),
  createdAt: Timestamp,
  ...questionFormatFields,
});
export type Assumption = z.infer<typeof Assumption>;

/** The control plane is the system of record for tickets (ADR-0016). */
export const Ticket = z.object({
  id: Id,
  projectId: Id,
  key: TicketKey,
  /** Empty at capture; refine fills it (ADR-0058). Readiness needs one. */
  type: TicketType.nullable(),
  parentId: Id.nullable(),
  title: z.string().min(1),
  body: z.string(),
  /** The checklist. Features: each in EARS form ("… shall …"); chores: any wording. */
  acceptanceCriteria: z.array(z.string()),
  assumptions: z.array(z.string()),
  stage: Stage,
  rank: z.string().min(1),
  size: Size.nullable(),
  /** One-line justification for the size (Definition of Ready, ARCHITECTURE §4.2). */
  sizeReason: z.string().nullable(),
  /** The build model tier is derived from size; `overrides.tier` pins one (ADR-0058). */
  overrides: TicketOverrides,
  /** Blocked on a human (open questions, a flag); a fact about the ticket (ADR-0058). */
  needsAttention: z.boolean(),
  dorStatus: DorStatus,
  blockedBy: z.array(Id),
  /**
   * Hidden from the board, the Needs-you inbox and status counts; only Done or Cancelled
   * tickets (AI-15: Cancel and archive tickets). The default keeps older documents readable.
   */
  archived: z.boolean().default(false),
  /** What the ticket must not change (ADR-0058). Defaults keep older documents readable. */
  outOfScope: ScopeList.default([]),
  /** Areas or path globs it expects to edit; empty means unknown, not "nothing". */
  touches: ScopeList.default([]),
  /**
   * Place in Up next (ADR-0075); null means Ideas, so older documents read as Ideas. Only a
   * Backlog ticket has one: leaving Backlog clears it.
   */
  upNextRank: z.string().min(1).nullable().default(null),
  /** When it last entered Up next; each entry runs refine once. */
  upNextAt: Timestamp.nullable().default(null),
  /** Refine's one line when it sent the ticket back to Ideas; cleared on the next entry. */
  sentBackReason: z.string().max(REFINE_REASON_MAX).nullable().default(null),
  /** What refine assumed instead of asking (ADR-0075). */
  refineAssumptions: z.array(Assumption).default([]),
  ...TicketScores,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Ticket = z.infer<typeof Ticket>;

export const TicketEventKind = z.enum([
  "created",
  "comment",
  "stage_changed",
  "fields_changed",
  "question_asked",
  "question_answered",
  "question_withdrawn",
  "run_linked",
  "pr_linked",
]);
export type TicketEventKind = z.infer<typeof TicketEventKind>;

/**
 * Who did it: "user:<uid>" (a signed-in user, by auth uid, AI-19) | "system" | "agent:<runId>".
 * "andy" is the owner's actor before AI-19: still valid, read as the owner.
 */
export const EventActor = z.string().regex(/^(andy|system|agent:.+|user:.+)$/);
export type EventActor = z.infer<typeof EventActor>;

/** Append-only ticket history; `actor` is an EventActor. */
export const TicketEvent = z.object({
  id: Id,
  ticketId: Id,
  kind: TicketEventKind,
  actor: EventActor,
  runId: Id.nullable(),
  body: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  createdAt: Timestamp,
});
export type TicketEvent = z.infer<typeof TicketEvent>;

export const QuestionStatus = z.enum(["open", "answered", "withdrawn"]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;
export const AnsweredVia = z.enum(["ui", "mcp"]);
export type AnsweredVia = z.infer<typeof AnsweredVia>;

export const Question = z.object({
  id: Id,
  projectId: Id,
  ticketId: Id,
  text: z.string().min(1),
  options: z.array(z.string()),
  suggestedAnswer: z.string().nullable(),
  assumptions: z.array(z.string()),
  urgency: Urgency,
  status: QuestionStatus,
  answer: z.string().nullable(),
  answeredVia: AnsweredVia.nullable(),
  createdAt: Timestamp,
  answeredAt: Timestamp.nullable(),
  /** The agent run that asked it (M1.7: Refinement); null when Andy or the system asked. */
  runId: Id.nullable().default(null),
  ...questionFormatFields,
});
export type Question = z.infer<typeof Question>;

/**
 * What a refine run returns (ARCHITECTURE §4.3, ADR-0075): a short report, an outcome, and the
 * gaps it found, each rated so the control plane (not the model) decides what becomes a question. Untrusted agent output, so every field is capped (ADR-0028). The executor hands the
 * agent the same shape as `platform/procedures/refine.schema.json`; this schema is the check.
 */
export const REFINE_LIMITS = {
  maxGaps: 10,
  /**
   * Same for an epic (M4.3): a split child that is still too big splits again when refined and stays
   * under the epic, so 5 keeps one result reviewable without capping the epic's size.
   */
  maxChildren: 5,
  title: 200,
  reason: REFINE_REASON_MAX,
  body: 4000,
  maxCriteria: 20,
  criterion: 500,
  summary: 4000,
  text: 500,
  maxOptions: 5,
  option: 200,
  maxAssumptions: 5,
  assumption: 300,
  sizeReason: 300,
  maxScopeItems: SCOPE_LIMITS.maxItems,
  scopeItem: SCOPE_LIMITS.item,
} as const;

const capped = (max: number) => z.string().trim().min(1).max(max);

export const RefineGap = z
  .strictObject({
    /** One plain question Andy can answer without reading the ticket (AI-73: question format). */
    question: questionLine(REFINE_LIMITS.text),
    /** The default refine would go with. Recorded if the gap becomes an assumption. */
    assumption: capped(REFINE_LIMITS.assumption),
    /** `context`, `options` as `{label, consequence}`, `recommendation` with a reason. */
    ...refineQuestionFields(REFINE_LIMITS.maxOptions),
    cost: GapCost,
    confidence: GapConfidence,
    urgency: Urgency.default("normal"),
  })
  .superRefine(recommendationIsAnOption);
export type RefineGap = z.infer<typeof RefineGap>;

/**
 * One ticket a split creates. `blockedBy` holds the 0-based indexes of sibling children it waits
 * on (M4.3, ARCHITECTURE workflow §4.4); `RefineOutput` checks they name other children and form
 * no cycle. Both new fields default to empty, so a result without them still parses.
 */
export const RefineChild = z.strictObject({
  title: capped(REFINE_LIMITS.title),
  body: capped(REFINE_LIMITS.body),
  blockedBy: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(REFINE_LIMITS.maxChildren - 1),
    )
    .max(REFINE_LIMITS.maxChildren - 1)
    .default([]),
  touches: z.array(capped(REFINE_LIMITS.scopeItem)).max(REFINE_LIMITS.maxScopeItems).default([]),
});
export type RefineChild = z.infer<typeof RefineChild>;

/** Why `children`' sibling links are invalid: self, unknown or repeated indexes, or a cycle. */
export function siblingDependencyIssues(children: readonly RefineChild[]): string[] {
  const issues: string[] = [];
  children.forEach((child, i) => {
    if (new Set(child.blockedBy).size !== child.blockedBy.length) {
      issues.push(`child ${i} names a sibling twice`);
    }
    for (const b of child.blockedBy) {
      if (b === i) issues.push(`child ${i} is blocked by itself`);
      else if (b >= children.length)
        issues.push(`child ${i} is blocked by child ${b}, not in the output`);
    }
  });
  if (issues.length > 0) return issues;
  // Repeatedly settle children whose blockers are all settled; any left over are in a cycle.
  const settled = new Set<number>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    children.forEach((child, i) => {
      if (!settled.has(i) && child.blockedBy.every((b) => settled.has(b))) {
        settled.add(i);
        progressed = true;
      }
    });
  }
  if (settled.size < children.length) issues.push("children block each other in a cycle");
  return issues;
}

/** `ready`: use the gaps. `send_back`: too vague, needs `reason`. `split`: too big, needs `children`. */
export const RefineOutcome = z.enum(["ready", "send_back", "split"]);
export type RefineOutcome = z.infer<typeof RefineOutcome>;

export const RefineOutput = z
  .strictObject({
    summary: capped(REFINE_LIMITS.summary),
    /** Refine's proposals; each written only where the ticket's field is empty, so Andy's values win. */
    type: TicketType,
    size: Size,
    sizeReason: capped(REFINE_LIMITS.sizeReason),
    ...RefineScores,
    outOfScope: z.array(capped(REFINE_LIMITS.scopeItem)).max(REFINE_LIMITS.maxScopeItems),
    touches: z.array(capped(REFINE_LIMITS.scopeItem)).max(REFINE_LIMITS.maxScopeItems),
    /** Written only where the ticket has none, like the proposals above. */
    body: capped(REFINE_LIMITS.body).nullable(),
    acceptanceCriteria: z.array(capped(REFINE_LIMITS.criterion)).max(REFINE_LIMITS.maxCriteria),
    outcome: RefineOutcome,
    /** One line for Andy: why it went back, or why it was split. */
    reason: capped(REFINE_LIMITS.reason).nullable(),
    children: z.array(RefineChild).max(REFINE_LIMITS.maxChildren),
    gaps: z.array(RefineGap).max(REFINE_LIMITS.maxGaps),
  })
  .superRefine((o, ctx) => {
    if (o.outcome !== "ready" && !o.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: `${o.outcome} needs a reason` });
    }
    if (o.outcome === "split" && o.children.length === 0) {
      ctx.addIssue({ code: "custom", path: ["children"], message: "split needs children" });
    }
    for (const message of siblingDependencyIssues(o.children)) {
      ctx.addIssue({ code: "custom", path: ["children"], message });
    }
  });
export type RefineOutput = z.infer<typeof RefineOutput>;

/**
 * What a build run returns (M1.8a: Build run, ADR-0063): its plan, written read-only before any
 * edit, what it did differently, and the checks it ran. Untrusted agent output, every field
 * capped (ADR-0028). `platform/procedures/build.schema.json` is the agent's copy; this is the check.
 */
export const BUILD_LIMITS = {
  summary: 4000,
  item: 500,
  path: 300,
  maxFiles: 50,
  maxSteps: 20,
  maxTests: 20,
  maxAlternatives: 5,
  maxDeviations: 10,
  maxChecks: 10,
  command: 200,
  checkOutput: 2000,
} as const;

export const BuildPlan = z.strictObject({
  files: z.array(capped(BUILD_LIMITS.path)).min(1).max(BUILD_LIMITS.maxFiles),
  steps: z.array(capped(BUILD_LIMITS.item)).min(1).max(BUILD_LIMITS.maxSteps),
  tests: z.array(capped(BUILD_LIMITS.item)).max(BUILD_LIMITS.maxTests),
  riskiestStep: capped(BUILD_LIMITS.item),
  rejectedAlternatives: z.array(capped(BUILD_LIMITS.item)).max(BUILD_LIMITS.maxAlternatives),
});
export type BuildPlan = z.infer<typeof BuildPlan>;

export const BuildCheck = z.strictObject({
  command: capped(BUILD_LIMITS.command),
  passed: z.boolean(),
  /** The last lines of its output. */
  output: z.string().max(BUILD_LIMITS.checkOutput),
});
export type BuildCheck = z.infer<typeof BuildCheck>;

export const BuildOutput = z.strictObject({
  summary: capped(BUILD_LIMITS.summary),
  plan: BuildPlan,
  deviations: z.array(capped(BUILD_LIMITS.item)).max(BUILD_LIMITS.maxDeviations),
  verification: z.array(BuildCheck).min(1).max(BUILD_LIMITS.maxChecks),
  /** Bug tickets: the test files that fail before the fix; committed first (ADR-0063). */
  failingTestFiles: z.array(capped(BUILD_LIMITS.path)).max(BUILD_LIMITS.maxTests),
});
export type BuildOutput = z.infer<typeof BuildOutput>;

/**
 * What a plan run returns (ADR-0050): the build plan, written read-only, for Andy to approve
 * before the build. Same caps as BuildOutput; `platform/procedures/plan.schema.json` is the
 * agent's copy.
 */
export const PlanOutput = z.strictObject({
  summary: capped(BUILD_LIMITS.summary),
  plan: BuildPlan,
});
export type PlanOutput = z.infer<typeof PlanOutput>;

/** Cap on a plan rejection's reason (ADR-0028); it goes into the next plan run's prompt. */
export const PLAN_REASON_MAX = 2000;

/** Andy's decision on a plan run: who (signed-in email) and when are recorded. */
export const PlanDecision = z.strictObject({
  decision: z.enum(["approved", "rejected"]),
  /** Required to reject; optional to approve. */
  reason: z.string().max(PLAN_REASON_MAX).nullable(),
  by: z.string().max(320),
  at: Timestamp,
});
export type PlanDecision = z.infer<typeof PlanDecision>;

export const RunStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunOutcome = z.enum(["merged_clean", "reworked", "reverted", "failed"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

/** Why the gate would not merge a PR (workflow.md §4.5). Recorded on the Run. */
export const GateReason = z.enum([
  "no_verification_output",
  "protected_path",
  "files_incomplete",
  "checks_incomplete",
  "no_required_checks",
  "checks_failed",
  "checks_pending",
  "draft",
  "not_default_branch",
  // A sync run is queued or running for the PR (AI-72, ADR-0083).
  "sync_pending",
]);
export type GateReason = z.infer<typeof GateReason>;

/** ADR-0040's run metrics; kept current by the gate and completed when the PR closes. */
export const RunMetrics = z.object({
  /** False once a required non-review check failed; null until the PR closes without one. */
  ciGreenFirstTry: z.boolean().nullable(),
  /** Review checks that failed, as "name@headSha", once each. */
  reviewFailures: z.array(z.string().max(300)).max(50),
  /** `reviewFailures.length` when the PR closed; null before. */
  reviewBlockers: z.number().int().nonnegative().nullable(),
  /** Commits on the PR not made by a bot; null before close or when they couldn't be read. */
  andyCommits: z.number().int().nonnegative().nullable(),
  /** Moves of the ticket from review back to In progress since the run began; null before close. */
  reworks: z.number().int().nonnegative().nullable(),
  /** The run's own cost, copied at close; an estimate on a subscription (`costIsEstimate`). */
  costEstimateUsd: z.number().nonnegative().nullable(),
});
export type RunMetrics = z.infer<typeof RunMetrics>;

/** Caps on run text (ADR-0028). */
export const RUN_PROMPT_MAX = 100_000;
export const RUN_SUMMARY_MAX = 20_000;

export const RunLinks = z.object({
  executorRun: z.url().optional(),
  pullRequest: z.url().optional(),
});

/**
 * Who the run must prove to be when it calls back (§9 agent callback auth), set at dispatch:
 * the repo it runs in, the executor definition it must run (e.g. a CI workflow ref) and the
 * code host's ID for the run.
 */
export const RunExecutor = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1),
  externalId: z.string().min(1),
});
export type RunExecutor = z.infer<typeof RunExecutor>;

export const Run = z.object({
  id: Id,
  projectId: Id,
  ticketId: Id.nullable(),
  step: RunStep,
  route: Route,
  tier: TierKey.nullable(),
  status: RunStatus,
  startedAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
  tokensIn: z.number().int().nonnegative().nullable(),
  tokensOut: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  costIsEstimate: z.boolean(),
  quotaSnapshot: z.record(z.string(), z.unknown()).nullable(),
  links: RunLinks,
  outcome: RunOutcome.nullable(),
  wouldAutoMerge: z.boolean().nullable(),
  // Added in M1.6a: Claude Code executor (defaults keep older documents readable).
  createdAt: Timestamp.nullable().default(null),
  /** When the run must have reported by; the watchdog (M1.6b) checks it then. */
  deadline: Timestamp.nullable().default(null),
  /** The instructions the run gets (ticket snapshot inside; untrusted text). */
  prompt: z.string().max(RUN_PROMPT_MAX).nullable().default(null),
  maxTurns: z.number().int().positive().nullable().default(null),
  /** The agent's report, capped. Untrusted text. */
  summary: z.string().max(RUN_SUMMARY_MAX).nullable().default(null),
  /** Why the run failed to start or finish, for Andy. */
  error: z.string().max(2000).nullable().default(null),
  executor: RunExecutor.nullable().default(null),
  // Added in M1.6b: Claude Code executor: watchdog + retry.
  /** 1 for a run Andy started; 2 for its automatic retry (at most one, ADR-0028). */
  attempt: z.number().int().positive().default(1),
  /** The run this one retries; null for a first attempt. */
  retryOf: Id.nullable().default(null),
  // Added in M1.8a: Build run (ADR-0063).
  /** A build run's plan, from its checked result. Untrusted agent text. */
  plan: BuildPlan.nullable().default(null),
  /** The branch a build run pushed (kept after a failure, for Andy to inspect). */
  branch: z.string().max(200).nullable().default(null),
  /** Tooling or dependency files the build's change touches, flagged on its PR (ADR-0063). */
  toolingFiles: z.array(z.string().max(300)).max(50).default([]),
  /** When the run's one repo token was issued to its publish job; null until then. */
  pushGrantedAt: Timestamp.nullable().default(null),
  // Added in M1.8a: Plan approval (ADR-0050).
  /** A plan run's decision; null while it awaits Andy (or for other steps). */
  planDecision: PlanDecision.nullable().default(null),
  /** A build run's approved plan run, whose plan is in its prompt; null without one. */
  planRunId: Id.nullable().default(null),
  /** A plan run's project policy when it started; a change makes the plan stale. */
  planPolicy: PlanApproval.nullable().default(null),
  // Added in M1.8b: Gate and auto-merge.
  /** A build's own checks, from its result; the gate vetoes when empty or without output. */
  verification: z.array(BuildCheck).max(BUILD_LIMITS.maxChecks).default([]),
  /** Empty when `wouldAutoMerge` is true or the gate hasn't run. */
  gateReasons: z.array(GateReason).max(GateReason.options.length).default([]),
  /** Changed paths the gate found protected, capped. */
  protectedFiles: z.array(z.string().max(300)).max(50).default([]),
  /** When the gate flagged the ticket for a protected path or missing output; flags once. */
  gateFlaggedAt: Timestamp.nullable().default(null),
  /** The head commit of the last merge attempt, set before the call: one attempt per head. */
  mergeAttemptedSha: z.string().max(64).nullable().default(null),
  /** Why the merge call failed. */
  mergeError: z.string().max(2000).nullable().default(null),
  metrics: RunMetrics.nullable().default(null),
  ...RunCostFields,
  ...runInFlightFields,
  ...runSyncFields,
  ...runLocalFields,
});
export type Run = z.infer<typeof Run>;

export const BillingType = z.enum(["subscription", "pay_per_use"]);
export type BillingType = z.infer<typeof BillingType>;

export const Provider = z.object({
  key: ProviderKey,
  billingType: BillingType,
  credentialSecretRef: z.string().min(1),
  quotaSource: z.string().nullable(),
  reservePct: z.number().min(0).max(100),
  warnPct: z.number().min(0).max(100),
  pausePct: z.number().min(0).max(100),
  dailyCapUsd: z.number().nonnegative().nullable(),
  monthlyCapUsd: z.number().nonnegative().nullable(),
  enabled: z.boolean(),
});
export type Provider = z.infer<typeof Provider>;

export const Harness = z.object({
  key: HarnessKey,
  runtime: z.enum(["actions", "api", "in-process"]),
  compatibleProviders: z.array(ProviderKey),
  capabilities: z.array(z.enum(["agentic", "skills", "subagents"])),
});
export type Harness = z.infer<typeof Harness>;

export const Model = z.object({
  id: z.string().min(1),
  provider: ProviderKey,
  priceInPerMTokUsd: z.number().nonnegative().nullable(),
  priceOutPerMTokUsd: z.number().nonnegative().nullable(),
  contextTokens: z.number().int().positive().nullable(),
  lastScoutedAt: Timestamp.nullable(),
});
export type Model = z.infer<typeof Model>;

export const Tier = z.object({
  key: TierKey,
  routes: z.array(Route).min(1),
});
export type Tier = z.infer<typeof Tier>;

export const Policy = z.object({
  id: Id,
  scope: PolicyScope,
  scopeId: Id.nullable(),
  /** Partial settings; resolved by override precedence ticket → epic → project → global. */
  settings: z.record(z.string(), z.unknown()),
});
export type Policy = z.infer<typeof Policy>;

export const QuotaWindow = z.enum(["5h", "weekly", "daily_tasks"]);
export type QuotaWindow = z.infer<typeof QuotaWindow>;

/** Who cleared a quota reading, and when (AI-74). `by` is the signed-in email. */
export const QuotaDiscard = z.object({ by: z.string().min(1).max(320), at: Timestamp });
export type QuotaDiscard = z.infer<typeof QuotaDiscard>;

export const QuotaReading = z.object({
  provider: ProviderKey,
  window: QuotaWindow,
  usedPct: z.number().min(0).max(100),
  resetsAt: Timestamp.nullable(),
  source: z.string().min(1),
  takenAt: Timestamp,
  confidence: z.enum(["high", "low"]),
  /**
   * Set when Andy cleared this reading because it held dispatch at the reserve (AI-74): dispatch
   * and the gauge then treat the window as unknown until the next reading replaces it.
   */
  discarded: QuotaDiscard.optional(),
});
export type QuotaReading = z.infer<typeof QuotaReading>;

/**
 * One cleared reading, kept after the next reading replaces it (AI-74): the history of quota
 * idles Andy cleared. Id: provider, window and the cleared reading's `takenAt`, so a reading is
 * cleared at most once.
 */
export const QuotaClear = z.object({
  id: z.string().min(1),
  provider: ProviderKey,
  window: QuotaWindow,
  usedPct: z.number().min(0).max(100),
  readingTakenAt: Timestamp,
  by: z.string().min(1).max(320),
  at: Timestamp,
});
export type QuotaClear = z.infer<typeof QuotaClear>;

/** What a clear did: the readings it discarded. */
export const QuotaClearResult = z.object({
  cleared: z.array(QuotaClear).min(1),
});
export type QuotaClearResult = z.infer<typeof QuotaClearResult>;

// Far enough for any real reset, and small enough that new Date() stays valid.
const EpochSeconds = z.number().int().positive().max(4_102_444_800);
// A fraction of the window. Above 1 is legitimate: usage can run past a window's cap.
const Utilization = z.number().min(0).max(100);
const WindowUsage = z.object({ utilization: Utilization, resetsAt: EpochSeconds });

/** Rate-limit data a run reports: the agent's last rate-limit event, in the harness's own names. */
export const RateLimitReport = z.object({
  unifiedWindows: z
    .object({ five_hour: WindowUsage.optional(), seven_day: WindowUsage.optional() })
    .optional(),
  rateLimitType: z.string().optional(),
  utilization: Utilization.optional(),
  resetsAt: EpochSeconds.optional(),
});
export type RateLimitReport = z.infer<typeof RateLimitReport>;

/** fresh: usable. stale: past its window's reset or too old. unknown: never read. */
export const QuotaFreshness = z.enum(["fresh", "stale", "unknown"]);
export type QuotaFreshness = z.infer<typeof QuotaFreshness>;

export const QuotaLevel = z.enum(["ok", "unknown", "warn", "pause"]);
export type QuotaLevel = z.infer<typeof QuotaLevel>;

/** One window as the UI sees it. `usedPct` is null unless fresh: never assume headroom. */
export const QuotaWindowStatus = z.object({
  window: QuotaWindow,
  freshness: QuotaFreshness,
  level: QuotaLevel,
  usedPct: z.number().min(0).max(100).nullable(),
  resetsAt: Timestamp.nullable(),
  takenAt: Timestamp.nullable(),
  source: z.string().nullable(),
});
export type QuotaWindowStatus = z.infer<typeof QuotaWindowStatus>;

export const QuotaStatus = z.object({
  provider: ProviderKey,
  warnPct: z.number().min(0).max(100),
  pausePct: z.number().min(0).max(100),
  /** The worst window: pause, then warn, then unknown, then ok. */
  level: QuotaLevel,
  windows: z.array(QuotaWindowStatus),
});
export type QuotaStatus = z.infer<typeof QuotaStatus>;

/** `accepted` (ADR-0097): Andy agreed to a proposal; applying it is separate (`applied`). */
export const ConfigChangeStatus = z.enum([
  "pending",
  "accepted",
  "applied",
  "reverted",
  "rejected",
]);
export type ConfigChangeStatus = z.infer<typeof ConfigChangeStatus>;

export const ConfigChange = z.object({
  id: Id,
  entity: z.string().min(1),
  entityId: z.string().min(1),
  diff: z.record(z.string(), z.unknown()),
  actor: Actor,
  reason: z.string(),
  status: ConfigChangeStatus,
  createdAt: Timestamp,
  appliedAt: Timestamp.nullable(),
  ...configChangeProposalFields,
});
export type ConfigChange = z.infer<typeof ConfigChange>;

export const Release = z.object({
  id: Id,
  projectId: Id,
  imageDigest: z.string().min(1),
  ticketIds: z.array(Id),
  notes: z.string(),
  status: z.enum([
    "pending",
    "deployed_dev",
    "awaiting_approval",
    "deployed_prod",
    "rolled_back",
    "failed",
  ]),
});
export type Release = z.infer<typeof Release>;

// ── Code host (ARCHITECTURE §6 `CodeHost`) ─────────────────────────────────────
// Repos, pull requests, checks and workflow runs as the domain sees them. Adapters map the
// vendor's webhook payloads onto these; raw payloads are never stored.

/** "owner/name", the code host's full repo name. Compare case-insensitively. */
export const RepoName = z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/);
export type RepoName = z.infer<typeof RepoName>;

export const Repo = z.object({
  /** Canonical spelling from the code host. */
  fullName: RepoName,
  defaultBranch: z.string().min(1),
  private: z.boolean(),
  url: z.url(),
});
export type Repo = z.infer<typeof Repo>;

export const PullRequestState = z.enum(["open", "closed", "merged"]);
export type PullRequestState = z.infer<typeof PullRequestState>;

export const PullRequest = z.object({
  number: z.number().int().positive(),
  state: PullRequestState,
  draft: z.boolean(),
  /** Untrusted text; capped by the adapter. */
  title: z.string().max(256),
  /** Untrusted text: the description's first line only (it may carry a ticket key), capped. */
  bodyFirstLine: z.string().max(256).default(""),
  /** Opened from another repo (anyone can do that on a public repo); never moves a ticket. */
  fromFork: z.boolean().default(false),
  /** Targets the repo's default branch; only such a merge completes a ticket (ADR-0056). */
  intoDefaultBranch: z.boolean().default(false),
  headRef: z.string().min(1),
  headSha: z.string().min(1),
  baseRef: z.string().min(1),
  url: z.url(),
});
export type PullRequest = z.infer<typeof PullRequest>;

/**
 * One file proposed as a pull request (AI-107): committed on a new branch cut from the default
 * branch, then opened into it. `content` is untrusted text; nothing reads it as instructions.
 */
export const FileProposal = z.object({
  branch: z.string().regex(/^[a-z][a-z0-9-]{0,30}\/[a-z0-9-]{1,60}$/),
  path: z
    .string()
    .regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/)
    .max(200)
    // Only plain relative segments: no `.` or `..` (the pattern already refuses a leading or
    // doubled `/`, backslashes and `%`, so nothing can be encoded or normalised around the
    // guard below).
    .refine((p) => p.split("/").every((seg) => seg !== "." && seg !== ".."), {
      message: "a proposal path can't have . or .. segments",
    })
    // Never workflows or agent settings, whoever calls it (defense in depth).
    .refine((p) => !/^\.(github|claude)(\/|$)/i.test(p), {
      message: "a proposal can't write under .github/ or .claude/",
    }),
  content: z.string().max(100_000),
  message: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  body: z.string().max(2000),
});
export type FileProposal = z.infer<typeof FileProposal>;

export const ProposedPullRequest = z.object({
  number: z.number().int().positive(),
  url: z.url(),
  branch: z.string().min(1),
});
export type ProposedPullRequest = z.infer<typeof ProposedPullRequest>;

export const CheckStatus = z.enum(["queued", "in_progress", "completed"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const CheckConclusion = z.enum([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "other",
]);
export type CheckConclusion = z.infer<typeof CheckConclusion>;

export const CheckRun = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(256),
  status: CheckStatus,
  conclusion: CheckConclusion.nullable(),
  headSha: z.string().min(1),
  url: z.url(),
  pullRequestNumbers: z.array(z.number().int().positive()),
});
export type CheckRun = z.infer<typeof CheckRun>;

/** One path a pull request changes; `previousPath` is set for a rename. Untrusted names. */
export const ChangedFile = z.object({
  path: z.string().min(1),
  previousPath: z.string().min(1).nullable(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

/** The latest result of one named check on a commit. `sourceId`: the app that reported it. */
export const HeadCheck = z.object({
  name: z.string().min(1).max(256),
  status: CheckStatus,
  conclusion: CheckConclusion.nullable(),
  sourceId: z.string().nullable(),
});
export type HeadCheck = z.infer<typeof HeadCheck>;

/** A check a branch requires; `sourceId` null means any reporter counts. */
export const RequiredCheck = z.object({
  name: z.string().min(1).max(256),
  sourceId: z.string().nullable(),
});
export type RequiredCheck = z.infer<typeof RequiredCheck>;

/** A commit on a pull request; `author` is the host login, else the git author name. */
export const PullRequestCommit = z.object({
  sha: z.string().min(1),
  author: z.string().nullable(),
});
export type PullRequestCommit = z.infer<typeof PullRequestCommit>;

/** A capped listing. `complete` false means more exist, so a caller must not assume none match. */
export interface Listing<T> {
  items: T[];
  complete: boolean;
}

/** A CI workflow run (GitHub Actions in v1.x); M1.6 correlates these with Runs. */
export const WorkflowRun = z.object({
  id: z.string().min(1),
  name: z.string().max(256),
  /** What started it, e.g. "pull_request", "workflow_dispatch". */
  trigger: z.string().min(1),
  status: CheckStatus,
  conclusion: CheckConclusion.nullable(),
  headBranch: z.string().nullable(),
  headSha: z.string().min(1),
  url: z.url(),
});
export type WorkflowRun = z.infer<typeof WorkflowRun>;

/** A CI workflow run just started on a repo's default branch. */
export const WorkflowDispatch = z.object({
  id: z.string().min(1),
  url: z.url(),
});
export type WorkflowDispatch = z.infer<typeof WorkflowDispatch>;

/** A short-lived token for one repo (contents + pull requests write), e.g. for a CI job. */
export const RepoToken = z.object({
  token: z.string().min(1),
  expiresAt: Timestamp,
  /** Git author name the token acts as, e.g. "andy-intelligence[bot]". */
  actor: z.string().min(1),
});
export type RepoToken = z.infer<typeof RepoToken>;

/**
 * Our App on the code host (ADR-0043): identifiers plus the two secrets. Created once from
 * the UI; the adapter keeps the secrets in a secret store, never next to the identifiers.
 */
export const CodeHostConnection = z.object({
  appId: z.string().regex(/^[0-9]+$/),
  slug: z.string().min(1),
  clientId: z.string().min(1),
  owner: z.string().min(1),
  privateKey: z.string().min(1),
  webhookSecret: z.string().min(1),
  connectedAt: Timestamp,
});
export type CodeHostConnection = z.infer<typeof CodeHostConnection>;

/** The code host's delivery ID; also the record's document ID, so no slashes. */
export const DeliveryId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

const CodeHostEventBase = z.object({
  deliveryId: DeliveryId,
  projectId: Id,
  repo: RepoName,
  /** Vendor action, e.g. "opened", "closed", "completed". */
  action: z.string().max(64),
  receivedAt: Timestamp,
});

/** A push to a branch (AI-72: the default branch moving queues sync runs). */
export const BranchPush = z.object({
  /** The branch name, without `refs/heads/`. */
  branch: z.string().min(1).max(256),
  /** The commit the branch now points at. */
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  /** Whether `branch` is the repo's default branch. */
  defaultBranch: z.boolean(),
});
export type BranchPush = z.infer<typeof BranchPush>;

/** One webhook delivery about a registered repo, normalized. Idempotent by `deliveryId`. */
export const CodeHostEvent = z.discriminatedUnion("kind", [
  CodeHostEventBase.extend({ kind: z.literal("pull_request"), pullRequest: PullRequest }),
  CodeHostEventBase.extend({ kind: z.literal("check_run"), checkRun: CheckRun }),
  CodeHostEventBase.extend({ kind: z.literal("workflow_run"), workflowRun: WorkflowRun }),
  CodeHostEventBase.extend({ kind: z.literal("push"), push: BranchPush }),
]);
export type CodeHostEvent = z.infer<typeof CodeHostEvent>;

export * from "./worker";
export * from "./executor";
export * from "./runner";
export * from "./night";
export * from "./config-proposals";
