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

/** The control plane is the system of record for tickets (ADR-0016). */
export const Ticket = z.object({
  id: Id,
  projectId: Id,
  key: TicketKey,
  type: TicketType,
  parentId: Id.nullable(),
  title: z.string().min(1),
  body: z.string(),
  /** EARS form: "WHEN … THE SYSTEM SHALL …" */
  acceptanceCriteria: z.array(z.string()),
  assumptions: z.array(z.string()),
  stage: Stage,
  rank: z.string().min(1),
  size: Size.nullable(),
  /** One-line justification for the size (Definition of Ready, ARCHITECTURE §4.2). */
  sizeReason: z.string().nullable(),
  tier: TierKey.nullable(),
  overrides: TicketOverrides,
  needsYou: z.boolean(),
  dorStatus: DorStatus,
  blockedBy: z.array(Id),
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
  /** Refine's proposal; written only where the ticket has none, so Andy's values win. */
  size: Size,
  sizeReason: capped(REFINE_LIMITS.sizeReason),
  tier: TierKey,
  questions: z
    .array(RefineQuestion)
    .min(REFINE_LIMITS.minQuestions)
    .max(REFINE_LIMITS.maxQuestions),
});
export type RefineOutput = z.infer<typeof RefineOutput>;

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
