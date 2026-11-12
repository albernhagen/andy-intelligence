import {
  RUNNER_LIMITS,
  MintRunner,
  WorkTrackerError,
  notFound,
  runnerIsActive,
  type EventActor,
  type MintedRunner,
  type Runner,
  type RunnerStore,
  type RunnerView,
  type WorkTracker,
} from "@andy/contracts";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";

/**
 * Local runner registration (ADR-0089 slice 3). Andy mints a runner in the UI and sees its secret
 * once; only the secret's hash is stored. A runner may claim while it is neither revoked nor
 * past its 90-day expiry; it is present while it claimed in the last 2 minutes.
 */

/** Makes and hashes credentials; the API passes its token helpers (no crypto in this package). */
export interface RunnerCredentials {
  /** A new secret: shown once, never stored. */
  newSecret(): string;
  /** The storage key for a secret or a per-run token. */
  hash(secret: string): string;
}

function log(severity: "INFO" | "WARNING", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "runners", ...fields }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the runner counts as present at `now` (ADR-0089: claimed in the last 2 minutes). */
export function isPresent(runner: Runner, now: Date): boolean {
  if (!runnerIsActive(runner, now) || !runner.lastSeenAt) return false;
  return now.getTime() - Date.parse(runner.lastSeenAt) < RUNNER_LIMITS.presentSeconds * 1000;
}

export function runnerView(runner: Runner, now: Date): RunnerView {
  const state =
    runner.revokedAt !== null
      ? "revoked"
      : Date.parse(runner.expiresAt) <= now.getTime()
        ? "expired"
        : "active";
  return { ...runner, present: isPresent(runner, now), state };
}

export class RunnerService {
  constructor(
    private readonly store: RunnerStore,
    private readonly tracker: WorkTracker,
    private readonly credentials: RunnerCredentials,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /** Owner-only (`mint_runner`). At most `RUNNER_LIMITS.maxRunners` active runners. */
  async mint(input: MintRunner, actor: EventActor): Promise<MintedRunner> {
    requireCan(actor, "mint_runner", null);
    const parsed = MintRunner.parse(input);
    const projectIds = [...new Set(parsed.projectIds)];
    for (const id of projectIds) {
      if (!(await this.tracker.getProject(id))) throw notFound("project", id);
    }
    const now = this.now();
    const secret = this.credentials.newSecret();
    const runner: Runner = {
      id: this.newId(),
      name: parsed.name,
      projectIds,
      runsAtOnce: parsed.runsAtOnce ?? RUNNER_LIMITS.runsAtOnceDefault,
      createdAt: now.toISOString(),
      createdBy: actor,
      expiresAt: new Date(now.getTime() + RUNNER_LIMITS.secretTtlDays * DAY_MS).toISOString(),
      revokedAt: null,
      lastSeenAt: null,
    };
    let created: Runner;
    try {
      created = await this.store.create(
        { runner, secretHash: this.credentials.hash(secret) },
        RUNNER_LIMITS.maxRunners,
        now,
      );
    } catch (err) {
      if (err instanceof WorkTrackerError && err.code === "conflict") {
        throw new DomainError(
          "runner_limit",
          `at most ${RUNNER_LIMITS.maxRunners} runners can be registered`,
          ["revoke one first"],
        );
      }
      throw err;
    }
    log("INFO", "runner minted", { runnerId: created.id, projectIds, by: actor });
    return { runner: runnerView(created, now), secret };
  }

  /** Every runner, newest first, with whether it is present. */
  async list(): Promise<RunnerView[]> {
    const now = this.now();
    return (await this.store.list()).map((r) => runnerView(r, now));
  }

  /** Owner-only (`revoke_runner`). Its next claim is refused; runs it holds lose their lease. */
  async revoke(runnerId: string, actor: EventActor): Promise<RunnerView> {
    requireCan(actor, "revoke_runner", null);
    const revoked = await this.store.revoke(runnerId, this.now().toISOString());
    log("INFO", "runner revoked", { runnerId, by: actor });
    return runnerView(revoked, this.now());
  }

  /** The active runner the secret belongs to; null for an unknown, revoked or expired one. */
  async authenticate(secret: string): Promise<Runner | null> {
    const runner = await this.store.findBySecretHash(this.credentials.hash(secret));
    if (!runner) return null;
    if (!runnerIsActive(runner, this.now())) {
      log("WARNING", "claim with a revoked or expired runner secret", { runnerId: runner.id });
      return null;
    }
    return runner;
  }

  /**
   * Records a claim (`lastSeenAt`); "too_soon" within `RUNNER_LIMITS.minClaimIntervalSeconds`
   * of the previous one (the API answers 429).
   */
  async recordClaim(runner: Runner): Promise<"ok" | "too_soon"> {
    return this.store.recordClaim(
      runner.id,
      this.now().toISOString(),
      RUNNER_LIMITS.minClaimIntervalSeconds * 1000,
    );
  }

  /** Whether a runner that may serve the project is present now. */
  async presentFor(projectId: string): Promise<boolean> {
    const now = this.now();
    return (await this.store.list()).some(
      (r) => r.projectIds.includes(projectId) && isPresent(r, now),
    );
  }

  async get(runnerId: string): Promise<Runner> {
    const runner = await this.store.get(runnerId);
    if (!runner) throw notFound("runner", runnerId);
    return runner;
  }
}
