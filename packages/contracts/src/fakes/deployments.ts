import {
  Deployment,
  DeploymentFinish,
  deploymentPageSize,
  finishedDeployment,
  withCachedRelease,
  type DeploymentEnvironment,
  type DeploymentVerification,
  type DeploymentVerificationStatus,
  type NewDeployment,
} from "../entities/deployment";
import type { StoredRelease } from "../entities/release-entry";
import { WorkTrackerError } from "../ports";
import { withVerification, type DeploymentStore } from "../ports/deployments";

/** Newest `startedAt` first; the id breaks ties so the order is stable. */
const newestFirst = (a: Deployment, b: Deployment) =>
  b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id);

/**
 * In-memory DeploymentStore. Every method reads and writes without an await in between, so
 * concurrent calls are atomic in one process, like the real store's transactions.
 */
export class InMemoryDeploymentStore implements DeploymentStore {
  private readonly deployments = new Map<string, Deployment>();

  async record(deployment: NewDeployment): Promise<Deployment> {
    const parsed = Deployment.parse({ ...deployment, id: crypto.randomUUID() });
    this.deployments.set(parsed.id, parsed);
    return structuredClone(parsed);
  }

  async finish(deploymentId: string, finish: DeploymentFinish): Promise<Deployment> {
    DeploymentFinish.parse(finish);
    const current = this.deployments.get(deploymentId);
    if (!current) throw new WorkTrackerError("not_found", `deployment ${deploymentId} not found`);
    if (current.status !== "started") {
      throw new WorkTrackerError("conflict", `deployment ${deploymentId} is ${current.status}`);
    }
    const next = finishedDeployment(current, finish);
    this.deployments.set(deploymentId, next);
    return structuredClone(next);
  }

  async get(deploymentId: string): Promise<Deployment | null> {
    const found = this.deployments.get(deploymentId);
    return found ? structuredClone(found) : null;
  }

  async cacheRelease(deploymentId: string, release: StoredRelease): Promise<Deployment> {
    const current = this.deployments.get(deploymentId);
    if (!current) throw new WorkTrackerError("not_found", `deployment ${deploymentId} not found`);
    const next = withCachedRelease(current, release);
    this.deployments.set(deploymentId, next);
    return structuredClone(next);
  }

  async setVerification(
    deploymentId: string,
    verification: DeploymentVerification,
    from: readonly (DeploymentVerificationStatus | null)[],
  ): Promise<Deployment> {
    const current = this.deployments.get(deploymentId);
    if (!current) throw new WorkTrackerError("not_found", `deployment ${deploymentId} not found`);
    const next = withVerification(current, verification, from);
    this.deployments.set(deploymentId, next);
    return structuredClone(next);
  }

  async list(
    projectId: string,
    environment: DeploymentEnvironment,
    limit?: number,
  ): Promise<Deployment[]> {
    return this.of(projectId, environment)
      .slice(0, deploymentPageSize(limit))
      .map((d) => structuredClone(d));
  }

  async latestGood(
    projectId: string,
    environment: DeploymentEnvironment,
  ): Promise<Deployment | null> {
    const found = this.of(projectId, environment).find((d) => d.status === "succeeded");
    return found ? structuredClone(found) : null;
  }

  private of(projectId: string, environment: DeploymentEnvironment): Deployment[] {
    return [...this.deployments.values()]
      .filter((d) => d.projectId === projectId && d.environment === environment)
      .sort(newestFirst);
  }
}
