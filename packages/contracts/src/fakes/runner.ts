import { Runner, RunTokenGrant, runnerIsActive } from "../entities/runner";
import { WorkTrackerError } from "../ports";
import type { NewRunnerRecord, RunnerStore } from "../ports/runner";

/**
 * In-memory RunnerStore. Every method reads and writes without an await in between, so
 * concurrent calls are atomic in one process, like the real store's transactions.
 */
export class InMemoryRunnerStore implements RunnerStore {
  private readonly runners = new Map<string, { runner: Runner; secretHash: string }>();
  private readonly tokens = new Map<string, RunTokenGrant>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(record: NewRunnerRecord, maxActive: number, now: Date): Promise<Runner> {
    const runner = Runner.parse(record.runner);
    const active = [...this.runners.values()].filter((r) => runnerIsActive(r.runner, now));
    if (active.length >= maxActive) {
      throw new WorkTrackerError("conflict", `at most ${maxActive} active runners`);
    }
    if (this.runners.has(runner.id)) {
      throw new WorkTrackerError("conflict", `runner ${runner.id} exists`);
    }
    this.runners.set(runner.id, { runner, secretHash: record.secretHash });
    return structuredClone(runner);
  }

  async get(runnerId: string): Promise<Runner | null> {
    const found = this.runners.get(runnerId);
    return found ? structuredClone(found.runner) : null;
  }

  async list(): Promise<Runner[]> {
    return [...this.runners.values()]
      .map((r) => structuredClone(r.runner))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  async findBySecretHash(secretHash: string): Promise<Runner | null> {
    const found = [...this.runners.values()].find((r) => r.secretHash === secretHash);
    return found ? structuredClone(found.runner) : null;
  }

  async revoke(runnerId: string, at: string): Promise<Runner> {
    const found = this.require(runnerId);
    if (found.runner.revokedAt === null) found.runner = { ...found.runner, revokedAt: at };
    return structuredClone(found.runner);
  }

  async recordClaim(
    runnerId: string,
    at: string,
    minIntervalMs: number,
  ): Promise<"ok" | "too_soon"> {
    const found = this.require(runnerId);
    const last = found.runner.lastSeenAt;
    if (last && Date.parse(at) - Date.parse(last) < minIntervalMs) return "too_soon";
    found.runner = { ...found.runner, lastSeenAt: at };
    return "ok";
  }

  async putRunToken(tokenHash: string, grant: RunTokenGrant): Promise<void> {
    this.tokens.set(tokenHash, RunTokenGrant.parse(grant));
  }

  async getRunToken(tokenHash: string): Promise<RunTokenGrant | null> {
    const grant = this.tokens.get(tokenHash);
    if (!grant || Date.parse(grant.expiresAt) <= this.now().getTime()) return null;
    return structuredClone(grant);
  }

  private require(runnerId: string) {
    const found = this.runners.get(runnerId);
    if (!found) throw new WorkTrackerError("not_found", `runner ${runnerId} not found`);
    return found;
  }
}
