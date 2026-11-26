import { FieldPath, type Firestore } from "@google-cloud/firestore";
import {
  Deployment,
  DeploymentFinish,
  WorkTrackerError,
  deploymentPageSize,
  finishedDeployment,
  withCachedRelease,
  withVerification,
  type DeploymentEnvironment,
  type DeploymentVerification,
  type DeploymentVerificationStatus,
  type DeploymentStore,
  type NewDeployment,
  type StoredRelease,
} from "@andy/contracts";
import { zodConverter } from "./index";

/** `deployments/{id}`: server-only, like every collection (the rules deny all client access). */
export const DEPLOYMENTS_COLLECTION = "deployments";

/** Larger than any millisecond timestamp until the year 2286; keeps the inverted key 13 digits. */
const MAX_MS = 9_999_999_999_999;

/**
 * The document id: the start time inverted and zero-padded, then a random suffix. Firestore
 * returns documents in id order when a query has only equality filters, so ascending id order is
 * newest `startedAt` first, with no composite index (no Terraform change) and with `limit`
 * bounding every read (ADR-0028).
 */
export function deploymentKey(startedAt: string): string {
  const inverted = String(MAX_MS - Date.parse(startedAt)).padStart(13, "0");
  return `${inverted}-${crypto.randomUUID()}`;
}

/**
 * DeploymentStore on Firestore (AI-161: M6.3). Reads are bounded: a listing reads at most
 * `DEPLOYMENT_LIMITS.maxPage` documents, the latest good one reads one.
 */
export class FirestoreDeploymentStore implements DeploymentStore {
  constructor(private readonly db: Firestore) {}

  private deployments() {
    return this.db.collection(DEPLOYMENTS_COLLECTION).withConverter(zodConverter(Deployment));
  }

  private of(projectId: string, environment: DeploymentEnvironment) {
    return this.deployments()
      .where("projectId", "==", projectId)
      .where("environment", "==", environment)
      .orderBy(FieldPath.documentId());
  }

  async record(deployment: NewDeployment): Promise<Deployment> {
    const parsed = Deployment.parse({ ...deployment, id: deploymentKey(deployment.startedAt) });
    await this.deployments().doc(parsed.id).create(parsed);
    return parsed;
  }

  async finish(deploymentId: string, finish: DeploymentFinish): Promise<Deployment> {
    DeploymentFinish.parse(finish);
    const ref = this.deployments().doc(deploymentId);
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (!current) throw new WorkTrackerError("not_found", `deployment ${deploymentId} not found`);
      if (current.status !== "started") {
        throw new WorkTrackerError("conflict", `deployment ${deploymentId} is ${current.status}`);
      }
      const next = finishedDeployment(current, finish);
      tx.set(ref, next);
      return next;
    });
  }

  async get(deploymentId: string): Promise<Deployment | null> {
    return (await this.deployments().doc(deploymentId).get()).data() ?? null;
  }

  async cacheRelease(deploymentId: string, release: StoredRelease): Promise<Deployment> {
    const ref = this.deployments().doc(deploymentId);
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (!current) throw new WorkTrackerError("not_found", `deployment ${deploymentId} not found`);
      if (current.release) return current;
      const next = withCachedRelease(current, release);
      tx.set(ref, next);
      return next;
    });
  }

  async setVerification(
    deploymentId: string,
    verification: DeploymentVerification,
    from: readonly (DeploymentVerificationStatus | null)[],
  ): Promise<Deployment> {
    const ref = this.deployments().doc(deploymentId);
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (!current) throw new WorkTrackerError("not_found", `deployment ${deploymentId} not found`);
      const next = withVerification(current, verification, from);
      tx.set(ref, next);
      return next;
    });
  }

  async list(
    projectId: string,
    environment: DeploymentEnvironment,
    limit?: number,
  ): Promise<Deployment[]> {
    const snap = await this.of(projectId, environment).limit(deploymentPageSize(limit)).get();
    return snap.docs.map((d) => d.data());
  }

  async latestGood(
    projectId: string,
    environment: DeploymentEnvironment,
  ): Promise<Deployment | null> {
    const snap = await this.of(projectId, environment)
      .where("status", "==", "succeeded")
      .limit(1)
      .get();
    return snap.docs[0]?.data() ?? null;
  }
}
