import {
  Deployment,
  DeploymentVerification,
  type DeploymentEnvironment,
  type DeploymentFinish,
  type DeploymentVerificationStatus,
  type NewDeployment,
} from "../entities/deployment";
import type { StoredRelease } from "../entities/release-entry";
import { WorkTrackerError } from "./index";

// ── DeploymentStore ──────────────────────────────────────────────────────────
// Deployments per project and environment (AI-161: M6.3). Storage only: who may record one and
// what a deployment means for tickets live in @andy/domain and the API (M6.4 on).
// Errors are WorkTrackerError (`not_found`, `conflict`), mapped the same way by the API.

export interface DeploymentStore {
  /** Stores a new deployment and returns it with the id the store assigned. */
  record(deployment: NewDeployment): Promise<Deployment>;
  /**
   * Ends a `started` deployment atomically. `conflict` if it already finished (nothing is
   * written), `not_found` if unknown.
   */
  finish(deploymentId: string, finish: DeploymentFinish): Promise<Deployment>;
  get(deploymentId: string): Promise<Deployment | null>;
  /**
   * Keeps a computed release on the deployment atomically (AI-183: M6.9), only if none is kept
   * yet; returns the deployment as stored (with the earlier release if one was there).
   * `not_found` if unknown.
   */
  cacheRelease(deploymentId: string, release: StoredRelease): Promise<Deployment>;
  /**
   * Sets the deployment's verification atomically (AI-188: M6.7), only if its current status is
   * one of `from` (null: none yet); `conflict` otherwise (nothing written), `not_found` if unknown.
   */
  setVerification(
    deploymentId: string,
    verification: DeploymentVerification,
    from: readonly (DeploymentVerificationStatus | null)[],
  ): Promise<Deployment>;
  /**
   * The project's deployments to one environment, newest `startedAt` first: at most `limit`
   * (default `DEPLOYMENT_LIMITS.defaultPage`), never more than `DEPLOYMENT_LIMITS.maxPage`.
   */
  list(
    projectId: string,
    environment: DeploymentEnvironment,
    limit?: number,
  ): Promise<Deployment[]>;
  /** The newest `succeeded` deployment of the project to that environment, or null. */
  latestGood(projectId: string, environment: DeploymentEnvironment): Promise<Deployment | null>;
}

/**
 * The deployment with its verification set (shared by every DeploymentStore), or `conflict` when
 * its current verification status isn't one of `from` (null: none yet), so two writers can't both
 * claim a waiting verification.
 */
export function withVerification(
  current: Deployment,
  verification: DeploymentVerification,
  from: readonly (DeploymentVerificationStatus | null)[],
): Deployment {
  const status = current.verification?.status ?? null;
  if (!from.includes(status)) {
    throw new WorkTrackerError(
      "conflict",
      `deployment ${current.id}'s verification is ${status ?? "unset"}, expected ${from.map((f) => f ?? "unset").join(" or ")}`,
    );
  }
  return Deployment.parse({ ...current, verification: DeploymentVerification.parse(verification) });
}
