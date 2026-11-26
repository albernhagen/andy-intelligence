import type {
  Deployment,
  DeploymentEnvironment,
  DeploymentFinish,
  NewDeployment,
} from "../entities/deployment";
import type { StoredRelease } from "../entities/release-entry";

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
