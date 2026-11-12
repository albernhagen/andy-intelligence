import { z } from "zod";
import { Id, RunStep, Timestamp } from "./common";
import { BaseBranch } from "./build";

/**
 * The local executor (ADR-0089): a runner program on Andy's Mac polls the control plane over plain
 * HTTPS and runs agent work there. Runner: the registered program and its long-lived secret.
 * Per-run token: a short-lived credential a claim returns, good for one run's callbacks only.
 *
 * The wire schemas below (`RunnerClaim*`, `RunHeartbeat*`, `RunContextResponse`,
 * `RunReportRequest`) are what the runner CLI (slice 5) is built against: additive changes only.
 */

/** Caps and timings (ADR-0028, ADR-0089 §Caps); the runner reads the timings, the server enforces. */
export const RUNNER_LIMITS = {
  /** Registered runners that are neither revoked nor expired (`MAX_RUNNERS`). */
  maxRunners: 2,
  name: 60,
  /** Projects one runner may serve. */
  maxProjects: 20,
  /** A runner secret expires this many days after it was minted. */
  secretTtlDays: 90,
  /** The runner polls this often while it has a free slot. */
  pollSeconds: 30,
  /** The server answers 429 to a second claim from one runner within this window. */
  minClaimIntervalSeconds: 10,
  /** A runner is present when it claimed within this window. */
  presentSeconds: 120,
  /** A claimed run's lease; each heartbeat renews it. */
  leaseSeconds: 300,
  /** The runner heartbeats each active run this often. */
  heartbeatSeconds: 60,
  /** Runs at once on one runner (`LOCAL_RUNS_AT_ONCE`): default 1, max 2. */
  runsAtOnceDefault: 1,
  runsAtOnceMax: 2,
} as const;

/** A registered runner as the control plane shows it. Its secret is never stored, only a hash. */
export const Runner = z.object({
  /** Opaque id; also names its Cloud Task and log lines. */
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  name: z.string().trim().min(1).max(RUNNER_LIMITS.name),
  /** The projects (ids, e.g. "ai") whose `local` tickets it may claim. */
  projectIds: z.array(Id).min(1).max(RUNNER_LIMITS.maxProjects),
  runsAtOnce: z
    .number()
    .int()
    .min(1)
    .max(RUNNER_LIMITS.runsAtOnceMax)
    .default(RUNNER_LIMITS.runsAtOnceDefault),
  createdAt: Timestamp,
  /** Who minted it: the signed-in user's actor (`user:<uid>`), never an email. */
  createdBy: z.string().min(1).max(200),
  expiresAt: Timestamp,
  revokedAt: Timestamp.nullable().default(null),
  /** The last accepted claim; present = within `RUNNER_LIMITS.presentSeconds`. */
  lastSeenAt: Timestamp.nullable().default(null),
});
export type Runner = z.infer<typeof Runner>;

/** A runner may still claim at `now`: not revoked and not past its expiry. */
export function runnerIsActive(
  runner: Pick<Runner, "revokedAt" | "expiresAt">,
  now: Date,
): boolean {
  return runner.revokedAt === null && Date.parse(runner.expiresAt) > now.getTime();
}

/** A runner with what the UI shows next to it, computed at read time. */
export const RunnerView = Runner.extend({
  present: z.boolean(),
  /** `active`: may claim. `revoked` and `expired` can never claim again. */
  state: z.enum(["active", "revoked", "expired"]),
});
export type RunnerView = z.infer<typeof RunnerView>;

/** What Andy fills in to mint a runner (UI and REST only; MCP can't mint, ADR-0089). */
export const MintRunner = z.strictObject({
  name: Runner.shape.name,
  projectIds: Runner.shape.projectIds,
  runsAtOnce: z.number().int().min(1).max(RUNNER_LIMITS.runsAtOnceMax).optional(),
});
export type MintRunner = z.infer<typeof MintRunner>;

/** The mint response: the secret appears here once and is never readable again. */
export const MintedRunner = z.object({
  runner: RunnerView,
  secret: z.string().min(1),
});
export type MintedRunner = z.infer<typeof MintedRunner>;

/** What a per-run token is bound to (stored by the token's hash). */
export const RunTokenGrant = z.object({
  runId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  runnerId: Runner.shape.id,
  /** The run's deadline: the token dies then, or earlier when the run ends. */
  expiresAt: Timestamp,
});
export type RunTokenGrant = z.infer<typeof RunTokenGrant>;

/** On a run a runner claimed (spread into `Run`). Null for runs on the cloud executor. */
export const LocalRunRecord = z.object({
  runnerId: Runner.shape.id,
  /** When the lease lapses unless a heartbeat renews it. */
  leaseExpiresAt: Timestamp,
  /** The last heartbeat; null until the first. */
  heartbeatAt: Timestamp.nullable(),
});
export type LocalRunRecord = z.infer<typeof LocalRunRecord>;

/** Spread into `Run`. Defaults keep older documents readable (no schema version bump). */
export const runLocalFields = {
  localRun: LocalRunRecord.nullable().default(null),
};

// ── Wire schemas (runner ⇄ control plane) ────────────────────────────────────

/**
 * `POST /runner/claim`, `Authorization: Bearer <runner secret>`. Names no ticket: the server
 * picks the work (ADR-0089). `version` is the runner's own, for logs only.
 */
export const RunnerClaimRequest = z.strictObject({
  version: z.string().max(40).optional(),
});
export type RunnerClaimRequest = z.infer<typeof RunnerClaimRequest>;

/** One claimed run: everything the runner needs before it fetches the context. */
export const ClaimedRun = z.object({
  runId: RunTokenGrant.shape.runId,
  /** The per-run token: `Authorization: Bearer <token>` on context, heartbeat, report, push token. */
  token: z.string().min(1),
  step: RunStep,
  /** The ticket key, for logs and the worktree name; untrusted ticket text is in the context. */
  ticketKey: z.string().max(30).nullable(),
  /** The run's repo, `owner/name`. */
  repo: z.string().min(1).max(200),
  deadline: Timestamp,
  leaseExpiresAt: Timestamp,
});
export type ClaimedRun = z.infer<typeof ClaimedRun>;

/** `{ run: null }` when there is nothing to do; poll again after `pollSeconds`. */
export const RunnerClaimResponse = z.object({
  run: ClaimedRun.nullable(),
  pollSeconds: z.number().int().positive(),
  heartbeatSeconds: z.number().int().positive(),
});
export type RunnerClaimResponse = z.infer<typeof RunnerClaimResponse>;

/** What the runner is doing, for logs; optional. */
export const RunPhase = z.enum(["starting", "agent", "publishing", "reporting"]);
export type RunPhase = z.infer<typeof RunPhase>;

/** `POST /runs/{id}/heartbeat`, `Authorization: Bearer <per-run token>`. */
export const RunHeartbeatRequest = z.strictObject({
  phase: RunPhase.optional(),
});
export type RunHeartbeatRequest = z.infer<typeof RunHeartbeatRequest>;

/**
 * `cancel: true`: Andy cancelled; stop the agent, publish nothing, then report `cancelled` (the
 * report is answered `duplicate`, the run is already ended). A heartbeat for a run that ended
 * any other way (lease lost, deadline) is refused with 409: stop and keep the worktree.
 */
export const RunHeartbeatResponse = z.object({
  cancel: z.boolean(),
  leaseExpiresAt: Timestamp.nullable(),
});
export type RunHeartbeatResponse = z.infer<typeof RunHeartbeatResponse>;

/** `GET /runs/{id}/context`: the run's instructions. The first call marks the run running. */
export const RunContextResponse = z.object({
  runId: z.string().min(1),
  step: RunStep,
  model: z.string().min(1),
  maxTurns: z.number().int().positive(),
  /** Untrusted ticket text inside: hand it to the agent as data. */
  prompt: z.string().min(1),
  ticket: z.object({ projectId: z.string(), key: z.string(), title: z.string() }).nullable(),
  /** The branch a build or sync run pushes; null for other steps. */
  branch: z.string().nullable(),
  sync: z.object({ pullRequest: z.number().int().positive(), headSha: z.string() }).nullable(),
  /** A build's base branch (`epic/<KEY>`, AI-122); null or absent: the default branch. */
  baseBranch: BaseBranch.nullable().optional(),
});
export type RunContextResponse = z.infer<typeof RunContextResponse>;

/** Report body cap: a 20,000-character summary plus the step's capped structured output. */
export const RUN_REPORT_MAX_BYTES = 96 * 1024;

/**
 * `POST /runs/{id}/report`, the same body from the Actions `report` job and the local runner.
 * `cancelled` only from the local runner after a heartbeat said `cancel: true`.
 */
export const RunReportRequest = z.object({
  status: z.enum(["succeeded", "failed", "cancelled"]),
  summary: z.string().nullable(),
  tokensIn: z.number().int().nonnegative().nullable(),
  tokensOut: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  /** The step's structured result (refine: RefineOutput); the control plane checks it. */
  output: z.unknown().optional(),
  /** Build: the branch and PR the publish step made; checked to be the run's own. */
  branch: z.string().max(200).nullable().optional(),
  pullRequest: z.string().max(500).nullable().optional(),
  /** Build: tooling or dependency files the change touches (flagged on the PR). */
  toolingFiles: z.array(z.string().max(300)).max(50).optional(),
  /** Sync: the PR already contained the default branch, so the agent didn't run (AI-72). */
  alreadyCurrent: z.boolean().optional(),
  /** Sync: the merge commit the publish step pushed. */
  headSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable()
    .optional(),
  /** The agent's last rate-limit event; checked separately, so a bad one can't lose the report. */
  rateLimits: z.unknown().optional(),
  /** The agent's token usage; checked separately, a bad one leaves the cost unknown. */
  usage: z.unknown().optional(),
});
export type RunReportRequest = z.infer<typeof RunReportRequest>;

/** `{ result: "duplicate" }` for a replayed or late report: nothing changed. */
export const RunReportResponse = z.object({ result: z.enum(["recorded", "duplicate"]) });
export type RunReportResponse = z.infer<typeof RunReportResponse>;
