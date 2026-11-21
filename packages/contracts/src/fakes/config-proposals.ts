import { ConfigChange } from "../entities";
import { ProposalLookupCursor, ReviewFinding } from "../entities/config-proposals";
import { WorkTrackerError } from "../ports";
import { CONFIG_CHANGE_LIST_MAX, GLOBAL_ENTITY_ID } from "../ports/config-changes";
import { appendedReason } from "../ports/config-proposals";
import type {
  ConfigChangeDecision,
  ConfigChangeStore,
  CreatePendingOutcome,
  RecentFindingsQuery,
  ReviewFindingSource,
} from "../ports/config-proposals";

const newestFirst = (a: ConfigChange, b: ConfigChange) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

/**
 * In-memory ConfigChangeStore. Every method reads and writes without an await in between, so
 * concurrent calls are atomic in one process, like the real store's transactions.
 */
/**
 * What a project's change log lists: its settings and routing changes (AI-239), keyed by
 * `entityId`, and its milestone changes (AI-304), keyed by `projectId` (their `entityId` is the
 * milestone or the epic).
 */
const LOGGED_ENTITIES = ["project", "routing"];
const inProjectLog = (c: ConfigChange, projectId: string) =>
  (LOGGED_ENTITIES.includes(c.entity) && c.entityId === projectId) ||
  (c.entity === "milestone" && c.projectId === projectId);

export class InMemoryConfigChangeStore implements ConfigChangeStore {
  private readonly changes = new Map<string, ConfigChange>();
  private readonly cursors = new Map<string, ProposalLookupCursor>();

  async createPending(change: ConfigChange, maxPending: number): Promise<CreatePendingOutcome> {
    const parsed = ConfigChange.parse(change);
    if (parsed.status !== "pending") {
      throw new WorkTrackerError("conflict", "only a pending change can be created here");
    }
    const pending = [...this.changes.values()].filter(
      (c) => c.status === "pending" && c.projectId === parsed.projectId,
    );
    const same =
      parsed.dedupeKey === null ? undefined : pending.find((c) => c.dedupeKey === parsed.dedupeKey);
    if (same) return { outcome: "duplicate", change: structuredClone(same) };
    if (pending.length >= maxPending) return { outcome: "capped", change: null };
    if (this.changes.has(parsed.id)) {
      throw new WorkTrackerError("conflict", `config change ${parsed.id} exists`);
    }
    this.changes.set(parsed.id, parsed);
    return { outcome: "created", change: structuredClone(parsed) };
  }

  async get(id: string): Promise<ConfigChange | null> {
    const found = this.changes.get(id);
    return found ? structuredClone(found) : null;
  }

  async append(change: ConfigChange): Promise<ConfigChange> {
    const parsed = ConfigChange.parse(change);
    if (this.changes.has(parsed.id)) {
      throw new WorkTrackerError("conflict", `config change ${parsed.id} exists`);
    }
    this.changes.set(parsed.id, parsed);
    return structuredClone(parsed);
  }

  async listForProject(projectId: string, limit = CONFIG_CHANGE_LIST_MAX): Promise<ConfigChange[]> {
    return [...this.changes.values()]
      .filter((c) => inProjectLog(c, projectId))
      .sort(newestFirst)
      .slice(0, Math.min(limit, CONFIG_CHANGE_LIST_MAX))
      .map((c) => structuredClone(c));
  }

  async listGlobal(entity: string, limit = CONFIG_CHANGE_LIST_MAX): Promise<ConfigChange[]> {
    return [...this.changes.values()]
      .filter((c) => c.entity === entity && c.entityId === GLOBAL_ENTITY_ID)
      .sort(newestFirst)
      .slice(0, Math.min(limit, CONFIG_CHANGE_LIST_MAX))
      .map((c) => structuredClone(c));
  }

  async markReverted(id: string, by: string, at: string): Promise<ConfigChange> {
    const found = this.changes.get(id);
    if (!found) throw new WorkTrackerError("not_found", `config change ${id} not found`);
    if (found.status !== "applied") {
      throw new WorkTrackerError("conflict", `config change ${id} is ${found.status}`);
    }
    const reverted = ConfigChange.parse({
      ...found,
      status: "reverted",
      decidedBy: by,
      decidedAt: at,
    });
    this.changes.set(id, reverted);
    return structuredClone(reverted);
  }

  async listPending(projectId?: string): Promise<ConfigChange[]> {
    return [...this.changes.values()]
      .filter((c) => c.status === "pending")
      .filter((c) => projectId === undefined || c.projectId === projectId)
      .sort(newestFirst)
      .map((c) => structuredClone(c));
  }

  async latestDecision(dedupeKey: string): Promise<ConfigChange | null> {
    const decided = [...this.changes.values()].filter(
      (c) => c.dedupeKey === dedupeKey && c.decidedAt !== null,
    );
    const latest = decided.sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))[0];
    return latest ? structuredClone(latest) : null;
  }

  async getLookupCursor(projectId: string): Promise<ProposalLookupCursor | null> {
    const cursor = this.cursors.get(projectId);
    return cursor ? structuredClone(cursor) : null;
  }

  async setLookupCursor(cursor: ProposalLookupCursor): Promise<void> {
    const parsed = ProposalLookupCursor.parse(cursor);
    this.cursors.set(parsed.projectId, parsed);
  }

  async decide(
    id: string,
    decision: ConfigChangeDecision,
    by: string,
    at: string,
  ): Promise<ConfigChange> {
    const found = this.changes.get(id);
    if (!found) throw new WorkTrackerError("not_found", `config change ${id} not found`);
    if (found.status !== "pending") {
      throw new WorkTrackerError("conflict", `config change ${id} is ${found.status}`);
    }
    const decided = ConfigChange.parse({
      ...found,
      status: decision,
      decidedBy: by,
      decidedAt: at,
    });
    this.changes.set(id, decided);
    return structuredClone(decided);
  }

  async appendReason(id: string, text: string): Promise<ConfigChange> {
    const found = this.changes.get(id);
    if (!found) throw new WorkTrackerError("not_found", `config change ${id} not found`);
    if (found.status !== "pending") {
      throw new WorkTrackerError("conflict", `config change ${id} is ${found.status}`);
    }
    const next = ConfigChange.parse({ ...found, reason: appendedReason(found.reason, text) });
    this.changes.set(id, next);
    return structuredClone(next);
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
