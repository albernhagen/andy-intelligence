import type { Runner, RunTokenGrant } from "../entities/runner";

// ── RunnerStore ──────────────────────────────────────────────────────────────
// Local runners (ADR-0089) and their per-run tokens. Credentials are kept only as hashes:
// callers hash the runner secret and the per-run token, so the store never holds a usable one.
// Errors are WorkTrackerError (`not_found`, `conflict`), mapped the same way by the API.

/** A runner to store, with its secret's hash (never returned by reads). */
export interface NewRunnerRecord {
  runner: Runner;
  secretHash: string;
}

export interface RunnerStore {
  /**
   * Stores the runner, atomically refusing (`conflict`) when `maxActive` runners are already
   * active (neither revoked nor expired at `now`): two concurrent mints can't pass the cap.
   */
  create(record: NewRunnerRecord, maxActive: number, now: Date): Promise<Runner>;
  get(runnerId: string): Promise<Runner | null>;
  /** Every runner, revoked and expired ones too, newest first. */
  list(): Promise<Runner[]>;
  /** The runner whose secret hashes to `secretHash`, revoked or not; null when none. */
  findBySecretHash(secretHash: string): Promise<Runner | null>;
  /** Sets `revokedAt` once; a second revoke returns the runner unchanged. `not_found` if unknown. */
  revoke(runnerId: string, at: string): Promise<Runner>;
  /**
   * A claim, atomically: sets `lastSeenAt` to `at`, unless the previous claim was less than
   * `minIntervalMs` before `at` ("too_soon", nothing written). `not_found` if unknown.
   */
  recordClaim(runnerId: string, at: string, minIntervalMs: number): Promise<"ok" | "too_soon">;
  putRunToken(tokenHash: string, grant: RunTokenGrant): Promise<void>;
  /** The grant, or null when missing or past `expiresAt`. */
  getRunToken(tokenHash: string): Promise<RunTokenGrant | null>;
}
