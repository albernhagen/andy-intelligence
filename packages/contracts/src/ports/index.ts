import { z } from "zod";
import {
  Assumption,
  AutoMerge,
  BillingType,
  DorStatus,
  EventActor,
  Id,
  Project,
  Worker,
  ExecutorKind,
  ProviderKey,
  Question,
  questionFormatFields,
  QuestionStatus,
  QuotaReading,
  Route,
  type QuotaClear,
  type QuotaDiscard,
  type QuotaWindow,
  PlanApproval,
  Run,
  RunExecutor,
  RunStatus,
  RunStep,
  ScopeList,
  Stage,
  Ticket,
  TicketScoreFields,
  Timestamp,
  Urgency,
  type AnsweredVia,
  type CodeHostConnection,
  type ChangedFile,
  type CodeHostEvent,
  type HeadCheck,
  type Listing,
  type PullRequest,
  type PullRequestCommit,
  type Repo,
  type RepoToken,
  type RequiredCheck,
  type TicketEvent,
  type WorkflowDispatch,
  type WorkflowRun,
  projectDispatchPatch,
  projectNotifyPatch,
  projectPlanPatch,
} from "../entities";

/**
 * Ports (ARCHITECTURE §6). Adapters implement these; the domain only sees these types.
 * WorkTracker, RunStore, WatchdogQueue, Executor, QuotaSource, OAuthGrantStore, CodeHost, CodeEventLog and
 * CodeHostConnectionStore have fakes + contract suites (see ../testing).
 * The rest are plain interfaces until a second adapter exists (ADR-0012).
 */

// ── WorkTracker ──────────────────────────────────────────────────────────────
// System of record for work (ADR-0016): projects, tickets, their history and questions.
// Storage only: stage rules and the Definition of Ready live in @andy/domain. Every write
// appends its TicketEvent in the same atomic step, so history can't miss a change.

/** A failed precondition the caller can act on; the API maps these to HTTP statuses. */
export class WorkTrackerError extends Error {
  constructor(
    readonly code: "not_found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "WorkTrackerError";
  }
}

export const NewProject = Project.pick({ name: true, key: true }).extend({
  repos: Project.shape.repos.default([]),
  autonomy: Project.shape.autonomy.default("gated"),
});
export type NewProject = z.input<typeof NewProject>;

/** A title alone is a valid ticket (ADR-0058); refine drafts the rest. */
export const NewTicket = Ticket.pick({ title: true }).extend({
  type: Ticket.shape.type.default(null),
  body: z.string().default(""),
  parentId: Id.nullable().default(null),
  acceptanceCriteria: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  size: Ticket.shape.size.default(null),
  sizeReason: Ticket.shape.sizeReason.default(null),
  outOfScope: Ticket.shape.outOfScope,
  touches: Ticket.shape.touches,
  overrides: Ticket.shape.overrides.default({}),
  blockedBy: z.array(Id).default([]),
  needsAttention: z.boolean().default(false),
  dorStatus: DorStatus.default("not_met"),
});
export type NewTicket = z.input<typeof NewTicket>;

/** Fields a caller may edit directly. Stage moves go through `stage` so they get their own event. */
export const TicketFields = Ticket.pick({
  type: true,
  title: true,
  body: true,
  parentId: true,
  acceptanceCriteria: true,
  assumptions: true,
  size: true,
  sizeReason: true,
  outOfScope: true,
  touches: true,
  overrides: true,
  needsAttention: true,
  dorStatus: true,
  blockedBy: true,
  rank: true,
  archived: true,
  upNextRank: true,
  upNextAt: true,
  sentBackReason: true,
  refineAssumptions: true,
  risk: true,
  riskReason: true,
  confidence: true,
  confidenceReason: true,
})
  .partial()
  // Zod 4 applies defaults inside `.partial()`, which would turn "not given" into "reset":
  // these fields are redeclared without their defaults.
  .extend({
    outOfScope: ScopeList.optional(),
    touches: ScopeList.optional(),
    archived: z.boolean().optional(),
    upNextRank: z.string().min(1).nullable().optional(),
    upNextAt: Timestamp.nullable().optional(),
    sentBackReason: z.string().max(300).nullable().optional(),
    refineAssumptions: z.array(Assumption).optional(),
    ...TicketScoreFields,
  });
export type TicketFields = z.infer<typeof TicketFields>;

export const TicketChange = z.object({
  fields: TicketFields.default({}),
  stage: z
    .object({ to: Stage, forced: z.boolean().default(false), reason: z.string().nullable() })
    .optional(),
  /** Optimistic concurrency: reject with `conflict` if the ticket changed since this read. */
  ifUpdatedAt: Timestamp.optional(),
});
export type TicketChange = z.input<typeof TicketChange>;

/** What a `pr_linked` event records about a pull request. */
export const PullRequestLink = z.object({
  number: z.number().int().positive(),
  url: z.url(),
  state: z.enum(["open", "closed", "merged"]),
});
export type PullRequestLink = z.infer<typeof PullRequestLink>;

/** What a board card shows besides the ticket itself (AI-28: Board v2). A read model, never stored. */
export const TicketSummary = z.object({
  openQuestions: z.number().int().nonnegative(),
  /** The newest run queued or running; null when none is in flight. */
  run: Run.pick({
    id: true,
    step: true,
    status: true,
    startedAt: true,
    createdAt: true,
  }).nullable(),
  /** The latest `pr_linked` event's pull request; null when none (or not looked up). */
  pullRequest: PullRequestLink.nullable(),
  /** Resolved at read time (ADR-0082). */
  worker: Worker,
});
export type TicketSummary = z.infer<typeof TicketSummary>;

/** A ticket as the board shows it. */
export const BoardTicket = Ticket.extend({ summary: TicketSummary });
export type BoardTicket = z.infer<typeof BoardTicket>;

export const NewQuestion = Question.pick({ text: true }).extend({
  ...questionFormatFields,
  options: z.array(z.string()).default([]),
  suggestedAnswer: z.string().nullable().default(null),
  assumptions: z.array(z.string()).default([]),
  urgency: Question.shape.urgency.default("normal"),
});
export type NewQuestion = z.input<typeof NewQuestion>;

export const QuestionFilter = z.object({
  projectId: Id.optional(),
  ticketId: Id.optional(),
  status: QuestionStatus.optional(),
});
export type QuestionFilter = z.infer<typeof QuestionFilter>;

/** Project settings Andy can change after registration. */
/**
 * Project settings a patch may change. Declared without defaults: Zod's `.partial()` keeps
 * field defaults, so a patch of one switch would reset the others.
 */
export const ProjectPatch = z.strictObject({
  autoRefine: z.boolean().optional(),
  autoBuild: z.boolean().optional(),
  buildEnabled: z.boolean().optional(),
  buildEnabledBy: z.string().max(320).nullable().optional(),
  buildEnabledAt: Timestamp.nullable().optional(),
  planApproval: PlanApproval.optional(),
  dailyQuestionCap: Project.shape.dailyQuestionCap.unwrap().optional(),
  autoMerge: AutoMerge.optional(),
  ...projectDispatchPatch,
  ...projectNotifyPatch,
  ...projectPlanPatch,
  defaultWorker: Worker.optional(),
  executor: ExecutorKind.optional(),
});
export type ProjectPatch = z.infer<typeof ProjectPatch>;

/** The settings a caller may change; who and when (`buildEnabledBy/At`) are set by the domain. */
export const ProjectSettings = ProjectPatch.pick({
  autoRefine: true,
  autoBuild: true,
  buildEnabled: true,
  planApproval: true,
  dailyQuestionCap: true,
  autoMerge: true,
  runsAtOnce: true,
  paused: true,
  defaultWorker: true,
  executor: true,
  emailNotifications: true,
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;

export const TicketFilter = z.object({
  stage: Stage.optional(),
  needsAttention: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type TicketFilter = z.infer<typeof TicketFilter>;

export interface WorkTracker {
  /** Project id is the lowercased key; a duplicate key is a `conflict`. */
  createProject(input: NewProject): Promise<Project>;
  getProject(projectId: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  /** `not_found` for an unknown project. */
  updateProject(projectId: string, patch: ProjectPatch): Promise<Project>;
  /**
   * Reserves the project's next ADR number atomically: one above both `atLeast` (the highest in
   * the repo's index) and every number reserved before. Never hands out a number twice (ADR-0080).
   */
  reserveAdrNumber(projectId: string, atLeast: number): Promise<number>;

  /** Allocates the next key (e.g. "AI-7") and appends a `created` event. */
  createTicket(projectId: string, input: NewTicket, actor: EventActor): Promise<Ticket>;
  getTicket(projectId: string, ticketId: string): Promise<Ticket | null>;
  /** Sorted by rank. */
  listTickets(projectId: string, filter?: TicketFilter): Promise<Ticket[]>;
  /** The project's ticket with this key (e.g. "AI-7"), or null. Reads only that ticket. */
  getTicketByKey(projectId: string, key: string): Promise<Ticket | null>;
  /**
   * Unarchived tickets per stage, every stage present. Counted by aggregation queries, not by
   * reading tickets (ADR-0028).
   */
  countByStage(projectId: string): Promise<Record<Stage, number>>;
  /** Appends `fields_changed` (only fields that differ) and/or `stage_changed`. */
  updateTicket(
    projectId: string,
    ticketId: string,
    change: TicketChange,
    actor: EventActor,
  ): Promise<Ticket>;
  addComment(
    projectId: string,
    ticketId: string,
    body: string,
    actor: EventActor,
  ): Promise<TicketEvent>;
  /** Appends `pr_linked` with the pull request's number, URL and state; the ticket is unchanged. */
  linkPullRequest(
    projectId: string,
    ticketId: string,
    link: PullRequestLink,
    actor: EventActor,
  ): Promise<TicketEvent>;
  /** Oldest first. */
  listEvents(projectId: string, ticketId: string): Promise<TicketEvent[]>;

  /** Appends `question_asked` to the ticket. */
  askQuestion(
    projectId: string,
    ticketId: string,
    input: NewQuestion,
    actor: EventActor,
  ): Promise<Question>;
  /**
   * Asks several questions at once: all are written, or none (one `question_asked` event each).
   * With `runId` the write is idempotent per run: if that run's questions exist already, they
   * are returned and nothing is written, so a replayed agent report can't duplicate them.
   */
  askQuestions(
    projectId: string,
    ticketId: string,
    inputs: NewQuestion[],
    actor: EventActor,
    runId?: string,
  ): Promise<Question[]>;
  /** Only open questions can be answered (`conflict` otherwise); appends `question_answered`. */
  answerQuestion(
    questionId: string,
    answer: string,
    via: AnsweredVia,
    actor: EventActor,
  ): Promise<Question>;
  /** Only open questions can be withdrawn (`conflict` otherwise); appends `question_withdrawn`. */
  withdrawQuestion(questionId: string, actor: EventActor): Promise<Question>;
  getQuestion(questionId: string): Promise<Question | null>;
  /** Oldest first. */
  listQuestions(filter?: QuestionFilter): Promise<Question[]>;
}

// ── Executor (DRAFT — do not freeze until two adapters pass; ADR-0006) ───────

export const RunRequest = z.object({
  runId: z.string().min(1),
  projectRef: z.string().min(1),
  ticketRef: z.string().nullable(),
  step: RunStep,
  route: Route,
  /** From the route's Provider: which credential the run uses (ADR-0050). */
  billingType: BillingType.default("subscription"),
  instructions: z.string().min(1),
  callbackUrl: z.url().nullable(),
});
export type RunRequest = z.input<typeof RunRequest>;

export const RunHandle = z.object({
  runId: z.string().min(1),
  externalId: z.string().min(1),
  url: z.url().nullable(),
  /** What the run must prove to be on callback; null for executors that don't call back. */
  executor: RunExecutor.nullable().default(null),
});
export type RunHandle = z.infer<typeof RunHandle>;

export const RunReport = z.object({
  runId: z.string().min(1),
  status: RunStatus,
  summary: z.string().nullable(),
  pullRequestUrl: z.url().nullable(),
  tokensIn: z.number().int().nonnegative().nullable(),
  tokensOut: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  costIsEstimate: z.boolean(),
});
export type RunReport = z.infer<typeof RunReport>;

export interface Executor {
  start(req: RunRequest): Promise<RunHandle>;
  status(handle: RunHandle): Promise<RunReport>;
  cancel(handle: RunHandle): Promise<void>;
}

// ── RunStore ─────────────────────────────────────────────────────────────────
// Run records (ARCHITECTURE §5): one per executor run, linked to its ticket. Status changes are
// conditional on the current status, so a late or replayed callback can't undo a finished run.
// Errors are WorkTrackerError (`not_found`, `conflict`), mapped the same way by the API.

export const NewRun = Run.pick({
  projectId: true,
  ticketId: true,
  step: true,
  route: true,
  tier: true,
  deadline: true,
  prompt: true,
  maxTurns: true,
  attempt: true,
  retryOf: true,
  planRunId: true,
  planPolicy: true,
  touches: true,
  reservedAdr: true,
  syncRun: true,
  localRun: true,
  baseBranch: true,
});
export type NewRun = z.input<typeof NewRun>;

/** Fields a status change may set. */
export const RunPatch = Run.pick({
  status: true,
  startedAt: true,
  endedAt: true,
  tokensIn: true,
  tokensOut: true,
  costUsd: true,
  costIsEstimate: true,
  usage: true,
  quotaDelta: true,
  links: true,
  summary: true,
  error: true,
  executor: true,
  plan: true,
  branch: true,
  toolingFiles: true,
  pushGrantedAt: true,
  planDecision: true,
  outcome: true,
  wouldAutoMerge: true,
  verification: true,
  gateReasons: true,
  protectedFiles: true,
  gateFlaggedAt: true,
  mergeAttemptedSha: true,
  mergeError: true,
  metrics: true,
  syncRun: true,
  prSync: true,
  localRun: true,
}).partial();
export type RunPatch = z.input<typeof RunPatch>;

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ["queued", "running"];

export interface RunStore {
  /** A new run in `queued`, with a generated id and `createdAt`. */
  create(input: NewRun): Promise<Run>;
  get(runId: string): Promise<Run | null>;
  /** Newest first. */
  listForTicket(projectId: string, ticketId: string): Promise<Run[]>;
  /** Runs in `queued` or `running` for the project. */
  listActive(projectId: string): Promise<Run[]>;
  /**
   * The project's runs whose `endedAt` is within [from, to], newest first (AI-70). Reads at most
   * `limit` runs; an adapter may count other projects' runs toward it. `complete` is false when
   * the cap was reached, so some runs may be missing.
   */
  listEndedBetween(
    projectId: string,
    from: string,
    to: string,
    limit: number,
  ): Promise<{ runs: Run[]; complete: boolean }>;
  /**
   * Applies the patch atomically, only if the run's status is one of `from` and, for a patch
   * that sets `planDecision`, the run has none yet, and for one that sets `mergeAttemptedSha`, it
   * isn't already that value; `conflict` otherwise, `not_found` when there
   * is no such run.
   */
  update(runId: string, patch: RunPatch, from: readonly RunStatus[]): Promise<Run>;
}

// ── WatchdogQueue ───────────────────────────────────────────────────────────
// Delayed checks of runs at their deadline (ARCHITECTURE §7.1 run watchdog). One check per run:
// the queue delivers it to the control plane at `at`, which looks at the run once. Nothing is
// queued when no run is in flight, so nothing runs (no polling).

export const WatchdogCheck = z.object({
  runId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  /** When to deliver the check: the run's deadline. */
  at: Timestamp,
});
export type WatchdogCheck = z.infer<typeof WatchdogCheck>;

/**
 * Other delayed checks on the same queue (ADR-0089): a local run's lease expiry, and whether a
 * runner is still away 2 minutes after its last claim.
 */
const CheckSubject = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
export const QueuedCheck = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lease"), runId: CheckSubject, at: Timestamp }),
  z.object({ kind: z.literal("runner_away"), runnerId: CheckSubject, at: Timestamp }),
]);
export type QueuedCheck = z.infer<typeof QueuedCheck>;

export interface WatchdogQueue {
  /**
   * Queues the run's check for delivery at `at`. Idempotent by run ID: a second call for the
   * same run queues nothing and returns "duplicate", so a run has at most one check.
   */
  schedule(check: WatchdogCheck): Promise<"scheduled" | "duplicate">;
  /**
   * Queues a lease or runner-away check for delivery at `at`. Idempotent per subject and time:
   * a lease per run and second of `at`, a runner-away check per runner and minute of `at`.
   */
  scheduleCheck(check: QueuedCheck): Promise<"scheduled" | "duplicate">;
}

/** The idempotency key of a queued check (also its task name on the queue). */
export function queuedCheckKey(check: QueuedCheck): string {
  const ms = Date.parse(check.at);
  return check.kind === "lease"
    ? `lease-${check.runId}-${Math.ceil(ms / 1000)}`
    : `runner-away-${check.runnerId}-${Math.floor(ms / 60_000)}`;
}

// ── QuotaSource ──────────────────────────────────────────────────────────────

export interface QuotaSource {
  /** Latest reading per window for the provider; empty when unknown. */
  latest(provider: ProviderKey): Promise<QuotaReading[]>;
}

export interface QuotaStore extends QuotaSource {
  /** Replaces the stored reading for each reading's provider and window. */
  save(readings: QuotaReading[]): Promise<void>;
  /**
   * Andy's clear (AI-74), atomically: marks each named reading discarded and records a clear for
   * it, but only while it is still the stored reading for its window (same `takenAt`) and not
   * already discarded. Returns the clears made; empty when none applied, e.g. a second clear.
   */
  discard(
    provider: ProviderKey,
    readings: { window: QuotaWindow; takenAt: string }[],
    by: QuotaDiscard,
  ): Promise<QuotaClear[]>;
  /** Clears made at or after `since` (ISO), newest first, at most `limit`. */
  clearsSince(provider: ProviderKey, since: string, limit: number): Promise<QuotaClear[]>;
}

/** A clear's id: one per reading, so a reading can be cleared at most once (AI-74). */
export function quotaClearId(provider: ProviderKey, window: QuotaWindow, takenAt: string): string {
  return `${provider}_${window}_${takenAt}`;
}

// ── OAuthGrantStore ──────────────────────────────────────────────────────────
// Short-lived credentials issued by the MCP OAuth server (ADR-0039: MCP OAuth facade):
// authorization codes, access tokens and refresh tokens. Callers key each grant by a hash
// of the token, so the store never holds a usable credential.

export const OAuthGrantKind = z.enum(["code", "access", "refresh"]);
export type OAuthGrantKind = z.infer<typeof OAuthGrantKind>;

export const OAuthGrant = z.object({
  kind: OAuthGrantKind,
  /** The OAuth client (a client ID metadata document URL). */
  clientId: z.string().min(1),
  /** Who approved the grant; re-checked against the allow-list on every use. */
  email: z.string().min(1),
  uid: z.string().min(1),
  /** The protected resource (MCP endpoint URL) the grant is for. */
  resource: z.url(),
  scope: z.string(),
  /** Code only: the redirect URI and PKCE S256 challenge it was issued for. */
  redirectUri: z.string().nullable(),
  codeChallenge: z.string().nullable(),
  expiresAt: Timestamp,
});
export type OAuthGrant = z.infer<typeof OAuthGrant>;

export interface OAuthGrantStore {
  put(key: string, grant: OAuthGrant): Promise<void>;
  /** The grant, or null when missing or expired. */
  get(key: string): Promise<OAuthGrant | null>;
  /**
   * Removes and returns the grant atomically (null when missing or expired), so codes and
   * refresh tokens are single-use even under concurrent requests.
   */
  take(key: string): Promise<OAuthGrant | null>;
}

// ── CodeHost ─────────────────────────────────────────────────────────────────
// The code host through our App (ARCHITECTURE §6). v1.x: GitHub App. Grows with the slices
// that need it (workflow dispatch: M1.6a; PR/check reads for the watchdog: M1.6b).

export interface CodeHost {
  /** The repo, or null when it doesn't exist or our App isn't installed on it. */
  getRepo(fullName: string): Promise<Repo | null>;
  /** Repos the App is installed on (at most 100), sorted by name. */
  listInstalledRepos(): Promise<Repo[]>;
  /**
   * A token for one repo with contents + pull requests write, valid about an hour; null when
   * the App isn't installed there. Callers decide who may get one (ADR-0043).
   */
  issueRepoToken(fullName: string): Promise<RepoToken | null>;
  /**
   * Starts `workflow` (a file name in the repo's workflow directory) on the default branch with
   * string inputs. Null when the App isn't installed on the repo.
   */
  dispatchWorkflow(
    fullName: string,
    workflow: string,
    inputs: Record<string, string>,
  ): Promise<WorkflowDispatch | null>;
  /** Null when the run or the repo isn't known. */
  getWorkflowRun(fullName: string, runId: string): Promise<WorkflowRun | null>;
  /** Asks the code host to stop the run; a finished or unknown run is a no-op. */
  cancelWorkflowRun(fullName: string, runId: string): Promise<void>;
  /** Null when the pull request or the repo isn't known. */
  getPullRequest(fullName: string, number: number): Promise<PullRequest | null>;
  /** Empty and complete when the repo isn't known. */
  listChangedFiles(fullName: string, number: number): Promise<Listing<ChangedFile>>;
  /** The latest result per check on a commit. */
  listHeadChecks(fullName: string, sha: string): Promise<Listing<HeadCheck>>;
  /** The checks `branch` requires before a merge; empty when none are configured. */
  listRequiredChecks(fullName: string, branch: string): Promise<RequiredCheck[]>;
  listPullRequestCommits(fullName: string, number: number): Promise<Listing<PullRequestCommit>>;
  /** The file's text at `ref`; null when there is no such file. */
  readFile(fullName: string, path: string, ref: string): Promise<string | null>;
  /**
   * Squash-merges with the App's identity, only if the head is still `expectedHeadSha`. Throws
   * when the host refuses (conflict, branch rules, a moved head).
   */
  mergePullRequest(fullName: string, number: number, expectedHeadSha: string): Promise<void>;
  /**
   * Whether commit `head` already contains `base` (a branch or commit): true when `head` is
   * ahead of it or the same. Null when the repo or a ref isn't known.
   */
  headContains(fullName: string, head: string, base: string): Promise<boolean | null>;
}

// ── CodeHostConnectionStore ──────────────────────────────────────────────────
// The one connection to our App (ADR-0043). Saved once by the setup flow; read by everything
// that talks to the code host.

export interface CodeHostConnectionStore {
  get(): Promise<CodeHostConnection | null>;
  /** Saves the first connection; "exists" (and nothing written) when one is already saved. */
  save(connection: CodeHostConnection): Promise<"saved" | "exists">;
}

// ── CodeEventLog ─────────────────────────────────────────────────────────────
// Webhook deliveries from the code host, recorded once each (ADR-0041). Later slices react to
// them (Run completion, PR outcome).

export type RecordResult = "recorded" | "duplicate";

export interface CodeEventLog {
  /**
   * Stores the event under its delivery ID, atomically. A delivery ID seen before is a no-op
   * that returns "duplicate" and leaves the first record unchanged (replays, redeliveries).
   */
  record(event: CodeHostEvent): Promise<RecordResult>;
  get(deliveryId: string): Promise<CodeHostEvent | null>;
}

// ── Plain interfaces (no contract suite yet) ─────────────────────────────────

export interface Completion {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ModelGateway {
  complete(model: string, prompt: string, opts?: { maxTokens?: number }): Promise<Completion>;
}

export interface Notice {
  title: string;
  body: string;
  urgency: z.infer<typeof Urgency>;
  link?: string;
}

export interface Notifier {
  notify(notice: Notice): Promise<void>;
}

export interface Deployer {
  promote(projectRef: string, imageDigest: string): Promise<{ releaseRef: string }>;
  rollback(projectRef: string, releaseRef: string): Promise<void>;
}

// ── Evaluator ────────────────────────────────────────────────────────────────
// Agent evals (M1.17: Agent evals v1, ADR-0040, ADR-0086): each case is an input plus
// deterministic checks on the agent's structured output. Thresholds live with the caller.

/** One case's outcome. `failures` are fixed evaluator messages, never model text. */
export const EvalCaseResult = z
  .object({
    caseId: z.string().min(1),
    /** `ran`: checks applied. `error`: no usable output. `skipped`: the run stopped first (quota). */
    status: z.enum(["ran", "error", "skipped"]),
    /** True only when the case ran and every check passed. */
    passed: z.boolean(),
    /** Input tokens of the agent's first model request (its loaded context); null when unknown. */
    inputTokens: z.number().int().nonnegative().nullable(),
    failures: z.array(z.string()),
  })
  .refine((r) => r.passed === (r.status === "ran" && r.failures.length === 0), {
    message: "passed means ran with no failures",
  });
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

export interface EvalSuiteRun {
  suite: string;
  /** One result per requested case, in request order. */
  cases: EvalCaseResult[];
  /** Highest subscription quota used (%) any case reported; null: none did; absent: not read. */
  quotaPct?: number | null;
}

export interface EvalRunOptions {
  caseIds: string[];
  /** Hard cap (ADR-0028): more cases than this is refused before anything runs. */
  maxCases: number;
}

export class EvalCapError extends Error {
  readonly name = "EvalCapError";
}

export interface Evaluator {
  score(suite: string, model: string): Promise<{ score: number; details?: unknown }>;
  /** Runs each case once (no retries). Rejects with EvalCapError above `maxCases`. */
  runSuite(suite: string, options: EvalRunOptions): Promise<EvalSuiteRun>;
}

export interface CostEvent {
  runId: string;
  provider: z.infer<typeof ProviderKey>;
  costUsd: number;
  isEstimate: boolean;
}

export interface Telemetry {
  recordCost(event: CostEvent): void;
}

export * from "./digest";
export * from "./notify-email";
export * from "./runner";
export * from "./night";
export * from "./config-proposals";
