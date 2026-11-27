import { FieldPath, type Firestore } from "@google-cloud/firestore";
import {
  ReleaseRequest,
  WorkTrackerError,
  patchedReleaseRequest,
  releaseRequestPageSize,
  type NewReleaseRequest,
  type ReleaseRequestPatch,
  type ReleaseRequestStatus,
  type ReleaseRequestStore,
} from "@andy/contracts";
import { z } from "zod";
import { deploymentKey } from "./deployments-store";
import { zodConverter } from "./index";

/** `releaseRequests/{id}`: server-only, like every collection (the rules deny all client access). */
export const RELEASE_REQUESTS_COLLECTION = "releaseRequests";
/** `releaseRequestLocks/{projectId}`: the newest request time per project, for the rate cap. */
export const RELEASE_REQUEST_LOCKS_COLLECTION = "releaseRequestLocks";

const Lock = z.object({ lastAt: z.string() });

/**
 * ReleaseRequestStore on Firestore (AI-199: M6.12). The id is the creation time inverted then a
 * random suffix (as for deployments), so a project's listing comes back newest first with
 * equality filters only (no composite index) and `limit` bounds every read (ADR-0028). The rate
 * cap reads and writes one lock document per project in the same transaction as the create, so
 * two API instances can't both pass it.
 */
export class FirestoreReleaseRequestStore implements ReleaseRequestStore {
  constructor(private readonly db: Firestore) {}

  private requests() {
    return this.db
      .collection(RELEASE_REQUESTS_COLLECTION)
      .withConverter(zodConverter(ReleaseRequest));
  }

  async create(
    request: NewReleaseRequest,
    minGapMs: number,
  ): Promise<{ created: ReleaseRequest } | { tooSoonUntil: string }> {
    const parsed = ReleaseRequest.parse({ ...request, id: deploymentKey(request.createdAt) });
    const lockRef = this.db
      .collection(RELEASE_REQUEST_LOCKS_COLLECTION)
      .withConverter(zodConverter(Lock))
      .doc(parsed.projectId);
    return this.db.runTransaction(async (tx) => {
      const lock = (await tx.get(lockRef)).data();
      const at = Date.parse(parsed.createdAt);
      const last = lock ? Date.parse(lock.lastAt) : null;
      if (last !== null && at - last < minGapMs) {
        return { tooSoonUntil: new Date(last + minGapMs).toISOString() };
      }
      tx.set(lockRef, { lastAt: new Date(Math.max(at, last ?? at)).toISOString() });
      tx.create(this.requests().doc(parsed.id), parsed);
      return { created: parsed };
    });
  }

  async get(requestId: string): Promise<ReleaseRequest | null> {
    return (await this.requests().doc(requestId).get()).data() ?? null;
  }

  async update(
    requestId: string,
    patch: ReleaseRequestPatch,
    from: readonly ReleaseRequestStatus[],
  ): Promise<ReleaseRequest> {
    const ref = this.requests().doc(requestId);
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (!current) {
        throw new WorkTrackerError("not_found", `release request ${requestId} not found`);
      }
      if (!from.includes(current.status)) {
        throw new WorkTrackerError("conflict", `release request ${requestId} is ${current.status}`);
      }
      const next = patchedReleaseRequest(current, patch);
      tx.set(ref, next);
      return next;
    });
  }

  async list(projectId: string, limit?: number): Promise<ReleaseRequest[]> {
    const snap = await this.requests()
      .where("projectId", "==", projectId)
      .orderBy(FieldPath.documentId())
      .limit(releaseRequestPageSize(limit))
      .get();
    return snap.docs.map((d) => d.data());
  }
}
