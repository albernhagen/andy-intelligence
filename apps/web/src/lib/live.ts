import { useEffect, useSyncExternalStore } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

/**
 * Live updates by tuned polling (AI-9, ADR-0091). The one place that decides how often a view
 * refetches; a push transport would replace this module, not the views.
 *
 * - Hidden tab: no polling (TanStack pauses intervals while `document.hidden`); focus refetches.
 * - Visible, Andy active or a run in flight: every 5 s, the floor.
 * - Visible, no input for 5 min and nothing in flight: every 60 s; his next input refetches.
 * - API unreachable: doubles per failed poll round up to 60 s, and the shell shows "Updates delayed".
 */

/** The floor: no query polls faster, so a tab can never hammer the API. */
export const LIVE_POLL_MS = 5_000;
/** Idle and "slow" views; also the most the error backoff waits. */
export const IDLE_POLL_MS = 60_000;
/** No pointer, key or wheel input for this long means Andy isn't watching. */
export const IDLE_AFTER_MS = 5 * 60_000;

/** `live`: tickets, runs, questions (5 s target). `slow`: projects, quota (60 s). */
export type Pace = "live" | "slow";

export interface PollInput {
  pace: Pace;
  /** A run is queued or running in this query's data: stay at 5 s even when idle. */
  inFlight: boolean;
  idle: boolean;
  /** Consecutive polls that could not reach the API. */
  failures: number;
}

/** Milliseconds to the next poll, always between the floor and the backoff cap. */
export function pollInterval({ pace, inFlight, idle, failures }: PollInput): number {
  const base = pace === "slow" || (idle && !inFlight) ? IDLE_POLL_MS : LIVE_POLL_MS;
  const backoff = LIVE_POLL_MS * 2 ** Math.max(0, failures);
  return Math.min(IDLE_POLL_MS, Math.max(LIVE_POLL_MS, base, backoff));
}

/** A failure that means updates are delayed: the API didn't answer, or answered 5xx. */
export const isUnreachable = (error: unknown) =>
  !(error instanceof ApiError) || error.status >= 500;

/**
 * Whether a polled view shows its query's error. A failed background poll keeps the last data on
 * screen (the shell's "Updates delayed" covers it); a first load that failed, or a 4xx, shows.
 */
export const showsError = (q: { error: unknown; data: unknown }) =>
  q.error != null && (q.data === undefined || !isUnreachable(q.error));

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/** Per-QueryClient state: Andy's last input and consecutive unreachable polls. */
export class LiveUpdates {
  private lastInputAt: number;
  private failures = 0;
  private lastFailureAt: number | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly queryClient: QueryClient,
    private readonly now: () => number = Date.now,
  ) {
    this.lastInputAt = now();
  }

  interval(pace: Pace, inFlight = false): number {
    return pollInterval({ pace, inFlight, idle: this.isIdle(), failures: this.failures });
  }

  isIdle(): boolean {
    return this.now() - this.lastInputAt >= IDLE_AFTER_MS;
  }

  /** Back from idle, the live views on screen refetch at once instead of waiting up to 60 s. */
  noteInput(): void {
    const wasIdle = this.isIdle();
    this.lastInputAt = this.now();
    if (wasIdle)
      void this.queryClient.refetchQueries(
        { type: "active", predicate: (q) => Boolean(q.meta?.live) },
        { cancelRefetch: false },
      );
  }

  /** The tab became visible: TanStack's focus refetch already runs, so only mark Andy active. */
  noteVisible(): void {
    this.lastInputAt = this.now();
  }

  /**
   * Counts failed poll rounds, not failed queries: the views on a page fail together, so
   * failures within one floor interval of the last counted one are the same round.
   */
  noteResult(reached: boolean): void {
    if (reached) {
      if (this.failures === 0) return;
      this.failures = 0;
      this.lastFailureAt = null;
    } else {
      const now = this.now();
      if (this.lastFailureAt !== null && now - this.lastFailureAt < LIVE_POLL_MS) return;
      this.lastFailureAt = now;
      this.failures += 1;
      console.warn(`live updates: poll round failed (${this.failures} in a row)`);
    }
    this.listeners.forEach((l) => l());
  }

  delayed = (): boolean => this.failures > 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Watches Andy's input and every live query's results; returns the cleanup. */
  start(): () => void {
    const onInput = () => this.noteInput();
    const onVisible = () => document.visibilityState === "visible" && this.noteVisible();
    INPUT_EVENTS.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = this.queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || !event.query.meta?.live) return;
      if (event.action.type === "success") this.noteResult(true);
      if (event.action.type === "error") this.noteResult(!isUnreachable(event.action.error));
    });
    return () => {
      INPUT_EVENTS.forEach((e) => window.removeEventListener(e, onInput));
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }
}

const byClient = new WeakMap<QueryClient, LiveUpdates>();

export function liveUpdatesFor(queryClient: QueryClient): LiveUpdates {
  let live = byClient.get(queryClient);
  if (!live) byClient.set(queryClient, (live = new LiveUpdates(queryClient)));
  return live;
}

export function useLiveUpdates(): LiveUpdates {
  return liveUpdatesFor(useQueryClient());
}

/** Query options for a polled view; `inFlight` keeps it at 5 s while its data shows a run. */
export function useLivePoll<T>(pace: Pace, inFlight?: (data: T) => boolean) {
  const live = useLiveUpdates();
  return {
    meta: { live: true },
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    // `unknown`, not `T`: a typed parameter here would override the query's own data type.
    refetchInterval: (q: { state: { data: unknown } }) =>
      live.interval(pace, q.state.data !== undefined && (inFlight?.(q.state.data as T) ?? false)),
  };
}

/** Mounted once in the shell: starts the watchers and says whether updates are delayed. */
export function useLiveStatus(): { delayed: boolean } {
  const live = useLiveUpdates();
  useEffect(() => live.start(), [live]);
  return { delayed: useSyncExternalStore(live.subscribe, live.delayed) };
}
