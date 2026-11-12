import { ConfigChange } from "../entities";
import { ReviewFinding } from "../entities/config-proposals";
import { WorkTrackerError } from "../ports";
import type {
  ConfigChangeFilter,
  ConfigChangeStore,
  RecentFindingsQuery,
  ReviewFindingSource,
} from "../ports/config-proposals";

const newestFirst = (a: ConfigChange, b: ConfigChange) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

/**
 * In-memory ConfigChangeStore. Every method reads and writes without an await in between, so
 * concurrent calls are atomic in one process, like the real store's transactions.
 */
export class InMemoryConfigChangeStore implements ConfigChangeStore {
  private readonly changes = new Map<string, ConfigChange>();

  async createPending(change: ConfigChange): Promise<{ created: boolean; change: ConfigChange }> {
    const parsed = ConfigChange.parse(change);
    if (parsed.status !== "pending") {
      throw new WorkTrackerError("conflict", "only a pending change can be created here");
    }
    if (parsed.dedupeKey !== null) {
      const existing = [...this.changes.values()].find(
        (c) => c.status === "pending" && c.dedupeKey === parsed.dedupeKey,
      );
      if (existing) return { created: false, change: structuredClone(existing) };
    }
    if (this.changes.has(parsed.id)) {
      throw new WorkTrackerError("conflict", `config change ${parsed.id} exists`);
    }
    this.changes.set(parsed.id, parsed);
    return { created: true, change: structuredClone(parsed) };
  }

  async get(id: string): Promise<ConfigChange | null> {
    const found = this.changes.get(id);
    return found ? structuredClone(found) : null;
  }

  async list(filter: ConfigChangeFilter): Promise<ConfigChange[]> {
    return [...this.changes.values()]
      .filter((c) => filter.projectId === undefined || c.projectId === filter.projectId)
      .filter((c) => filter.status === undefined || c.status === filter.status)
      .sort(newestFirst)
      .slice(0, filter.limit)
      .map((c) => structuredClone(c));
  }

  async reject(id: string, by: string, at: string): Promise<ConfigChange> {
    const found = this.changes.get(id);
    if (!found) throw new WorkTrackerError("not_found", `config change ${id} not found`);
    if (found.status !== "pending") {
      throw new WorkTrackerError("conflict", `config change ${id} is ${found.status}`);
    }
    const rejected = ConfigChange.parse({
      ...found,
      status: "rejected",
      decidedBy: by,
      decidedAt: at,
    });
    this.changes.set(id, rejected);
    return structuredClone(rejected);
  }
}

/** In-memory ReviewFindingSource; tests `add` findings. */
export class InMemoryReviewFindingSource implements ReviewFindingSource {
  private readonly findings: ReviewFinding[] = [];

  add(...findings: ReviewFinding[]): void {
    this.findings.push(...findings.map((f) => ReviewFinding.parse(f)));
  }

  async recent(projectId: string, query: RecentFindingsQuery): Promise<ReviewFinding[]> {
    return recentFindings(
      this.findings.filter((f) => f.projectId === projectId),
      query,
    );
  }
}

/**
 * The `recent` rule shared by the fake and adapters: PRs ordered by their latest finding,
 * the newest `maxPulls` kept, then their findings newest first, capped at `maxFindings`.
 */
export function recentFindings(
  findings: readonly ReviewFinding[],
  query: RecentFindingsQuery,
): ReviewFinding[] {
  const sorted = [...findings].sort(
    (a, b) =>
      b.recordedAt.localeCompare(a.recordedAt) ||
      a.repo.localeCompare(b.repo) ||
      a.pullNumber - b.pullNumber,
  );
  const pulls = new Set<string>();
  for (const f of sorted) {
    if (pulls.size >= query.maxPulls) break;
    pulls.add(pullKey(f));
  }
  return sorted
    .filter((f) => pulls.has(pullKey(f)))
    .slice(0, query.maxFindings)
    .map((f) => structuredClone(f));
}

/** One PR across repos: repo names compare case-insensitively. */
export const pullKey = (f: { repo: string; pullNumber: number }) =>
  `${f.repo.toLowerCase()}#${f.pullNumber}`;
