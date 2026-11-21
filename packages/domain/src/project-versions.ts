import type { ProjectVersions, RunStore, WorkTracker } from "@andy/contracts";

/**
 * Change counters and the read cache behind them (AI-222: Firestore reads grow with project
 * size). Every write to a project's tickets, questions, history or agent tasks bumps its counter;
 * the board and the ticket list cache their result per counter value, so an unchanged poll reads
 * one document. Each instance (Cloud Run runs up to 2) has its own cache; the counter is shared,
 * so a write on one instance is seen by the other on its next poll.
 */

/** Tracker writes, and how each names its project: the first argument, or the result's. */
const TRACKER_WRITES = {
  updateProject: "arg",
  createTicket: "arg",
  updateTicket: "arg",
  addComment: "arg",
  linkPullRequest: "arg",
  askQuestion: "arg",
  askQuestions: "arg",
  answerQuestion: "result",
  withdrawQuestion: "result",
} as const satisfies Partial<Record<keyof WorkTracker, "arg" | "result">>;

const RUN_WRITES = { create: "result", update: "result" } as const satisfies Partial<
  Record<keyof RunStore, "arg" | "result">
>;

/**
 * The tracker and run store with every write bumping its project's counter after it lands. A
 * failed bump is logged and the write stands: the cache's age cap bounds how stale it gets.
 */
export function bumpOnWrite(
  tracker: WorkTracker,
  runs: RunStore,
  versions: ProjectVersions,
): { tracker: WorkTracker; runs: RunStore } {
  return {
    tracker: withBumps(tracker, TRACKER_WRITES, versions),
    runs: withBumps(runs, RUN_WRITES, versions),
  };
}

function withBumps<T extends object>(
  target: T,
  writes: Partial<Record<string, "arg" | "result">>,
  versions: ProjectVersions,
): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value: unknown = Reflect.get(t, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => Promise<unknown>;
      const from = typeof prop === "string" ? writes[prop] : undefined;
      if (!from) return fn.bind(t);
      return async (...args: unknown[]) => {
        const result = await fn.apply(t, args);
        const projectId = from === "arg" ? args[0] : (result as { projectId?: unknown }).projectId;
        if (typeof projectId === "string") await bumpLogged(versions, projectId, String(prop));
        return result;
      };
    },
  });
}

async function bumpLogged(versions: ProjectVersions, projectId: string, write: string) {
  try {
    await versions.bump(projectId);
  } catch (err) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "project version bump failed; cached reads may lag until the next write",
        component: "project-versions",
        projectId,
        write,
        error: String(err),
      }),
    );
  }
}

/** Longest a cached view is served without a fresh read, even if no bump was seen (ADR-0028). */
export const PROJECT_CACHE_MAX_AGE_MS = 5 * 60_000;
/** Cached views kept per instance; the oldest goes first past it (ADR-0028). */
export const PROJECT_CACHE_MAX_ENTRIES = 200;

interface Entry {
  version: number;
  at: number;
  value: unknown;
}

/** A project's views by name (`board`, a ticket-list filter), each kept for one counter value. */
export class ProjectReadCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly versions: ProjectVersions,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The cached view while the project's counter is unchanged and the entry is young enough;
   * otherwise `load`'s result, cached under the counter read before loading (a write during the
   * load bumps past it, so the next call loads again).
   */
  async get<T>(projectId: string, view: string, load: () => Promise<T>): Promise<T> {
    const key = `${projectId}\u0000${view}`;
    let version: number;
    try {
      version = await this.versions.get(projectId);
    } catch (err) {
      // The view still loads, uncached, as it did before the cache (AI-222).
      console.error(
        JSON.stringify({
          severity: "ERROR",
          message: "project version read failed; loading without the cache",
          component: "project-versions",
          projectId,
          view,
          error: String(err),
        }),
      );
      return load();
    }
    const hit = this.entries.get(key);
    if (hit && hit.version === version && this.now() - hit.at < PROJECT_CACHE_MAX_AGE_MS) {
      return hit.value as T;
    }
    const value = await load();
    this.entries.delete(key);
    this.entries.set(key, { version, at: this.now(), value });
    if (this.entries.size > PROJECT_CACHE_MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    return value;
  }
}
