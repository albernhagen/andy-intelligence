import { z } from "zod";
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

export * from "./common";

/** ARCHITECTURE §5 — domain model. Vendor concepts must not appear here. */

export const AutonomyLevel = z.enum(["autonomous", "gated", "manual"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

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
  /** Refine starts on its own for new and answered Backlog tickets (ADR-0054); default on. */
  autoRefine: z.boolean().default(true),
  /**
   * The build dispatcher takes Ready tickets on its own, top of the order first (ADR-0063);
   * default off: Andy turns it on per project.
   */
  autoBuild: z.boolean().default(false),
});
export type Project = z.infer<typeof Project>;

export const TicketOverrides = z.object({
  assignee: z.union([z.literal("me"), HarnessKey]).optional(),
  tier: TierKey.optional(),
  modelPin: Route.optional(),
  autonomy: AutonomyLevel.optional(),
  targetEnv: z.enum(["dev", "prod"]).optional(),
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

/** Who did it: "andy" | "system" | "agent:<runId>". */
export const EventActor = z.string().regex(/^(andy|system|agent:.+)$/);
export type EventActor = z.infer<typeof EventActor>;

/** Append-only ticket history. actor: "andy" | "system" | "agent:<runId>". */
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
});
export type Question = z.infer<typeof Question>;

/**
 * What a refine run returns (M1.7: Refinement, ARCHITECTURE §4.3): a short report and 1–5
 * questions. Untrusted agent output, so every field is capped (ADR-0028). The executor hands the
 * agent the same shape as `platform/procedures/refine.schema.json`; this schema is the check.
 */
export const REFINE_LIMITS = {
  minQuestions: 1,
  maxQuestions: 5,
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

export const RefineQuestion = z.strictObject({
  text: capped(REFINE_LIMITS.text),
  options: z.array(capped(REFINE_LIMITS.option)).max(REFINE_LIMITS.maxOptions).default([]),
  suggestedAnswer: capped(REFINE_LIMITS.option).nullable().default(null),
  assumptions: z
    .array(capped(REFINE_LIMITS.assumption))
    .max(REFINE_LIMITS.maxAssumptions)
    .default([]),
  urgency: Urgency.default("normal"),
});
export type RefineQuestion = z.infer<typeof RefineQuestion>;

export const RefineOutput = z.strictObject({
  summary: capped(REFINE_LIMITS.summary),
  /** Refine's proposals; each written only where the ticket's field is empty, so Andy's values win. */
  type: TicketType,
  size: Size,
  sizeReason: capped(REFINE_LIMITS.sizeReason),
  outOfScope: z.array(capped(REFINE_LIMITS.scopeItem)).max(REFINE_LIMITS.maxScopeItems),
  touches: z.array(capped(REFINE_LIMITS.scopeItem)).max(REFINE_LIMITS.maxScopeItems),
  questions: z
    .array(RefineQuestion)
    .min(REFINE_LIMITS.minQuestions)
    .max(REFINE_LIMITS.maxQuestions),
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

export const RunStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunOutcome = z.enum(["merged_clean", "reworked", "reverted", "failed"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

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
  /** When the run's one repo token was issued to its publish job; null until then. */
  pushGrantedAt: Timestamp.nullable().default(null),
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

export const QuotaReading = z.object({
  provider: ProviderKey,
  window: QuotaWindow,
  usedPct: z.number().min(0).max(100),
  resetsAt: Timestamp.nullable(),
  source: z.string().min(1),
  takenAt: Timestamp,
  confidence: z.enum(["high", "low"]),
});
export type QuotaReading = z.infer<typeof QuotaReading>;

export const ConfigChangeStatus = z.enum(["pending", "applied", "reverted", "rejected"]);

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

/** One webhook delivery about a registered repo, normalized. Idempotent by `deliveryId`. */
export const CodeHostEvent = z.discriminatedUnion("kind", [
  CodeHostEventBase.extend({ kind: z.literal("pull_request"), pullRequest: PullRequest }),
  CodeHostEventBase.extend({ kind: z.literal("check_run"), checkRun: CheckRun }),
  CodeHostEventBase.extend({ kind: z.literal("workflow_run"), workflowRun: WorkflowRun }),
]);
export type CodeHostEvent = z.infer<typeof CodeHostEvent>;
