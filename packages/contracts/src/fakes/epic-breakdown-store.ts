import { EpicBreakdown } from "../entities/epic-breakdown";
import { WorkTrackerError } from "../ports";
import { WAITING_BREAKDOWNS_MAX, type EpicBreakdownStore } from "../ports/epic-breakdown-store";

const key = (projectId: string, epicId: string) => `${projectId}\u0000${epicId}`;

/** In-memory EpicBreakdownStore: synchronous updates, so atomic within one process. */
export class InMemoryEpicBreakdownStore implements EpicBreakdownStore {
  private readonly rows = new Map<string, EpicBreakdown>();

  async get(projectId: string, epicId: string): Promise<EpicBreakdown | null> {
    const b = this.rows.get(key(projectId, epicId));
    return b ? structuredClone(b) : null;
  }

  async put(breakdown: EpicBreakdown, ifUpdatedAt: string | null): Promise<EpicBreakdown> {
    const b = EpicBreakdown.parse(breakdown);
    const k = key(b.projectId, b.epicId);
    const stored = this.rows.get(k);
    if ((stored?.updatedAt ?? null) !== ifUpdatedAt) {
      throw new WorkTrackerError(
        "conflict",
        `epic ${b.epicId}'s breakdown changed since it was read`,
      );
    }
    this.rows.set(k, b);
    return structuredClone(b);
  }

  async listWaiting(projectId: string): Promise<EpicBreakdown[]> {
    return [...this.rows.values()]
      .filter((b) => b.projectId === projectId)
      .filter((b) => b.status === "proposed" || b.status === "approving")
      .slice(0, WAITING_BREAKDOWNS_MAX)
      .map((b) => structuredClone(b));
  }
}
