import {
  ReleaseRequest,
  patchedReleaseRequest,
  releaseRequestPageSize,
  type NewReleaseRequest,
  type ReleaseRequestPatch,
  type ReleaseRequestStatus,
} from "../entities/release-request";
import { WorkTrackerError } from "../ports";
import type { ReleaseRequestStore } from "../ports/release-requests";

/** Newest `createdAt` first; the id breaks ties so the order is stable. */
const newestFirst = (a: ReleaseRequest, b: ReleaseRequest) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

/**
 * In-memory ReleaseRequestStore. Every method reads and writes without an await in between, so
 * concurrent calls are atomic in one process, like the real store's transactions.
 */
export class InMemoryReleaseRequestStore implements ReleaseRequestStore {
  private readonly requests = new Map<string, ReleaseRequest>();
  /** The newest request time per project: the rate cap's state. */
  private readonly lastAt = new Map<string, number>();

  async create(
    request: NewReleaseRequest,
    minGapMs: number,
  ): Promise<{ created: ReleaseRequest } | { tooSoonUntil: string }> {
    const parsed = ReleaseRequest.parse({ ...request, id: crypto.randomUUID() });
    const at = Date.parse(parsed.createdAt);
    const last = this.lastAt.get(parsed.projectId);
    if (last !== undefined && at - last < minGapMs) {
      return { tooSoonUntil: new Date(last + minGapMs).toISOString() };
    }
    this.lastAt.set(parsed.projectId, Math.max(at, last ?? at));
    this.requests.set(parsed.id, parsed);
    return { created: structuredClone(parsed) };
  }

  async get(requestId: string): Promise<ReleaseRequest | null> {
    const found = this.requests.get(requestId);
    return found ? structuredClone(found) : null;
  }

  async update(
    requestId: string,
    patch: ReleaseRequestPatch,
    from: readonly ReleaseRequestStatus[],
  ): Promise<ReleaseRequest> {
    const current = this.requests.get(requestId);
    if (!current) throw new WorkTrackerError("not_found", `release request ${requestId} not found`);
    if (!from.includes(current.status)) {
      throw new WorkTrackerError("conflict", `release request ${requestId} is ${current.status}`);
    }
    const next = patchedReleaseRequest(current, patch);
    this.requests.set(requestId, next);
    return structuredClone(next);
  }

  async list(projectId: string, limit?: number): Promise<ReleaseRequest[]> {
    return [...this.requests.values()]
      .filter((r) => r.projectId === projectId)
      .sort(newestFirst)
      .slice(0, releaseRequestPageSize(limit))
      .map((r) => structuredClone(r));
  }
}
