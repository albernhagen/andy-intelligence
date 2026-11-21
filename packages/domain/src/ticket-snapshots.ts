import { compareRanks, type Ticket, type TicketFilter, type WorkTracker } from "@andy/contracts";
import { PROJECT_CACHE_MAX_AGE_MS } from "./project-versions";

/**
 * Each project's tickets, kept per instance and refreshed by what changed (AI-317: board and
 * ticket list re-read every ticket after any change). The first read of a project reads every
 * ticket; after that, each new project version reads only the tickets changed since the newest
 * one seen, so a poll after one write reads a few documents however big the project is.
 * Tickets are never deleted (archiving is a change), so merging changes keeps the set whole.
 */

/**
 * The changed-since query starts this far before the newest change seen. A write stamped by
 * another instance's clock, or one still committing when the last query ran, lands within it.
 */
export const SNAPSHOT_OVERLAP_MS = 60_000;
/** A snapshot this old is read again in full, bounding any drift (ADR-0028). */
export const SNAPSHOT_FULL_READ_MS = 60 * 60_000;
/** Projects kept per instance; the least recently read goes first past it (ADR-0028). */
export const SNAPSHOT_MAX_PROJECTS = 200;

interface Snapshot {
  byId: Map<string, Ticket>;
  /** The newest `updatedAt` seen. */
  newest: string;
  /** The project version this snapshot is current for. */
  version: number;
  loadedAt: number;
  /** When it last read changes (or loaded): past the cache's max age it reads changes again. */
  refreshedAt: number;
  sorted: Ticket[];
}

export class TicketSnapshots {
  private readonly projects = new Map<string, Snapshot>();

  constructor(
    private readonly tracker: WorkTracker,
    private readonly now: () => number = Date.now,
  ) {}

  /** The project's tickets (archived too) at `version`, sorted by rank. */
  async tickets(projectId: string, version: number): Promise<Ticket[]> {
    const snap = this.projects.get(projectId);
    if (!snap || this.now() - snap.loadedAt >= SNAPSHOT_FULL_READ_MS) {
      return this.keep(projectId, await this.readAll(projectId, version)).sorted;
    }
    // A new version, or a write that didn't bump it (outside the app): read what changed. The
    // second shows within the cache's max age, as ADR-0126 promises.
    if (snap.version !== version || this.now() - snap.refreshedAt >= PROJECT_CACHE_MAX_AGE_MS) {
      const since = new Date(Date.parse(snap.newest) - SNAPSHOT_OVERLAP_MS).toISOString();
      const changed = await this.tracker.listTicketsChangedSince(projectId, since);
      for (const t of changed) snap.byId.set(t.id, t);
      snap.newest = newestOf(changed, snap.newest);
      snap.version = version;
      snap.refreshedAt = this.now();
      snap.sorted = sortByRank(snap.byId);
    }
    return this.keep(projectId, snap).sorted;
  }

  private async readAll(projectId: string, version: number): Promise<Snapshot> {
    const all = await this.tracker.listTickets(projectId);
    const byId = new Map(all.map((t) => [t.id, t]));
    const at = this.now();
    return { byId, newest: newestOf(all, ""), version, loadedAt: at, refreshedAt: at, sorted: all };
  }

  private keep(projectId: string, snap: Snapshot): Snapshot {
    this.projects.delete(projectId);
    this.projects.set(projectId, snap);
    if (this.projects.size > SNAPSHOT_MAX_PROJECTS) {
      this.projects.delete(this.projects.keys().next().value!);
    }
    return snap;
  }
}

function newestOf(tickets: Ticket[], from: string): string {
  return tickets.reduce((n, t) => (t.updatedAt > n ? t.updatedAt : n), from);
}

function sortByRank(byId: Map<string, Ticket>): Ticket[] {
  return [...byId.values()].sort((a, b) => compareRanks(a.rank, b.rank));
}

/** Whether `ticket` passes `filter`, as `WorkTracker.listTickets` filters. */
export function matchesTicketFilter(ticket: Ticket, filter: TicketFilter): boolean {
  return (
    (filter.stage === undefined || ticket.stage === filter.stage) &&
    (filter.needsAttention === undefined || ticket.needsAttention === filter.needsAttention) &&
    (filter.archived === undefined || ticket.archived === filter.archived) &&
    (!filter.upNext || (ticket.stage === "backlog" && ticket.upNextRank != null))
  );
}
