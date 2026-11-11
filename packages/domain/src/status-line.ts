import {
  ACTIVE_RUN_STATUSES,
  compareRanks,
  type InFlightRun,
  type PullRequestLink,
  type Run,
  type RunStep,
  type Stage,
  type SyncWaitReason,
  type Ticket,
  type TicketEvent,
  type TicketSummary,
  type Worker,
} from "@andy/contracts";
import { overlappingKey } from "./dispatch-conflicts";

/** The story panel's first line (ADR-0059): where the ticket is and what it waits for. */
export type StatusTone = "default" | "attention" | "running" | "success" | "danger";

export interface StatusInput {
  stage: Stage;
  archived: boolean;
  needsAttention: boolean;
  dorMet: boolean;
  openQuestions: number;
  /** The run in flight, if any. */
  run: TicketSummary["run"];
  /** The latest pull request linked to the ticket. */
  pr: Pick<PullRequestLink, "number" | "state"> | null;
  /** Keys of the blockers that are not Done or Cancelled yet. */
  blockedBy: string[];
  /** 1-based place among the unblocked Ready tickets (1 = the board's "Next"); null otherwise. */
  queuePosition: number | null;
  /** Who does the work (ADR-0082); undefined until it loads. */
  worker?: Worker;
  /** The in-flight ticket whose touches a Ready ticket overlaps (ADR-0080); null or absent: none. */
  overlaps?: string | null;
  /** Why the last sync run stopped (AI-72), shown while the ticket waits for Andy; null: none. */
  syncStopped?: string | null;
  /** Why the PR's wanted sync hasn't started (AI-72); null or absent: none waits. */
  syncWaiting?: string | null;
  /**
   * The oldest open question's line (AI-73). Given (the digest gives it), it replaces the count
   * on the open-question line; absent, the line counts the questions as before.
   */
  questionLine?: string | null;
}

const QUESTION_LINE_MAX = 200;

/** The line while questions wait: the oldest one's line when given (AI-73), else the count. */
function questionsWaiting(n: number, question?: string | null): string {
  if (!question) return `Waiting for you: ${n} question${n === 1 ? "" : "s"}`;
  const q =
    question.length > QUESTION_LINE_MAX ? `${question.slice(0, QUESTION_LINE_MAX)}…` : question;
  const more = n > 1 ? ` (and ${n - 1} more question${n === 2 ? "" : "s"})` : "";
  return `Waiting for you: ${q}${more}`;
}

export function statusLine(s: StatusInput, now: Date): { text: string; tone: StatusTone } {
  const { text, tone } = mainStatus(s, now);
  return { text: s.archived ? `${text} · archived` : text, tone };
}

function mainStatus(s: StatusInput, now: Date): { text: string; tone: StatusTone } {
  const pr = s.pr ? `PR #${s.pr.number} ${s.pr.state}` : null;
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ");

  if (s.stage === "cancelled") return { text: "Cancelled", tone: "default" };
  if (s.stage === "done") return { text: join("Done", pr), tone: "success" };
  if (s.openQuestions > 0) {
    return { text: questionsWaiting(s.openQuestions, s.questionLine), tone: "attention" };
  }
  if (s.needsAttention) {
    return {
      text: s.syncStopped ? `Waiting for you: ${s.syncStopped}` : "Waiting for you",
      tone: "attention",
    };
  }
  // The same words as the run marker on the board card (`runLabel`).
  if (s.run) return { text: join(runLabel(s.run, now.getTime()), pr), tone: "running" };
  if (s.blockedBy.length > 0) return { text: `Blocked by ${list(s.blockedBy)}`, tone: "danger" };

  if (s.worker === "me" && (s.stage === "ready" || s.stage === "in_progress")) {
    return { text: "Mine · waiting on you", tone: "attention" };
  }
  if (s.worker === "ask" && (s.stage === "ready" || s.stage === "in_progress")) {
    return { text: "Needs a worker", tone: "attention" };
  }

  switch (s.stage) {
    case "backlog":
      return {
        text: s.dorMet ? "Backlog · ready to move to Ready" : "Backlog · needs refining",
        tone: "default",
      };
    case "ready":
      if (s.overlaps) return { text: `Waiting: overlaps ${s.overlaps} in flight`, tone: "default" };
      return {
        text:
          s.queuePosition === null
            ? "Ready"
            : s.queuePosition === 1
              ? "Ready · next in the queue"
              : `Ready · ${ordinal(s.queuePosition)} in the queue`,
        tone: "default",
      };
    case "in_progress":
      return {
        text: join("In progress", pr ?? "no run in flight", waits(s.syncWaiting)),
        tone: "default",
      };
    case "ready_for_review":
      return { text: join("Ready for review", pr, waits(s.syncWaiting)), tone: "default" };
  }
}

const waits = (why: string | null | undefined) => (why ? `sync with main waits: ${why}` : null);

/** Plain words for why a wanted sync waits (status line, digest). */
export const SYNC_WAIT_WORDS: Record<SyncWaitReason, string> = {
  paused: "dispatch is paused",
  global_cap: "the global cap is reached",
  quota_reserve: "quota is at the reserve",
  daily_cap: "3 syncs in 24 hours",
  ticket_busy: "another run of the ticket is in flight",
  builds_off: "builds are off, so no sync runs",
  pr_cap: "not checked yet (more open PRs than one check covers); next in line",
};

/**
 * Why the ticket's open PR waits for a sync (AI-72), from its newest build run with a PR; null
 * when none waits. `runs` is newest first.
 */
export function syncWaiting(runs: readonly Run[]): string | null {
  const build = runs.find((r) => r.step === "build" && r.links.pullRequest);
  const state = build?.prSync;
  if (!state?.waiting) return null;
  // Unchecked (past the per-tick cap) and builds-off waits hold no veto, but are still news.
  const shown = state.pendingSince || state.waiting === "pr_cap" || state.waiting === "builds_off";
  return shown ? SYNC_WAIT_WORDS[state.waiting] : null;
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

function list(keys: string[]): string {
  return keys.length === 1
    ? keys[0]!
    : `${keys.slice(0, -1).join(", ")} and ${keys[keys.length - 1]}`;
}

/** The latest `pr_linked` event's pull request (events are oldest first). */
export function latestPullRequest(
  events: readonly TicketEvent[],
): Pick<PullRequestLink, "number" | "state"> | null {
  const e = events.findLast((e) => e.kind === "pr_linked");
  const { number, state } = e?.data ?? {};
  if (typeof number !== "number") return null;
  return state === "open" || state === "closed" || state === "merged" ? { number, state } : null;
}

/** Blockers that are not finished yet (Done or Cancelled), as tickets on this board. */
export function openBlockers(ticket: Ticket, byId: ReadonlyMap<string, Ticket>): Ticket[] {
  return ticket.blockedBy
    .map((id) => byId.get(id))
    .filter((t): t is Ticket => !!t && t.stage !== "done" && t.stage !== "cancelled");
}

/** Keys of the blockers not finished yet. */
export function openBlockerKeys(ticket: Ticket, tickets: readonly Ticket[]): string[] {
  return openBlockers(ticket, new Map(tickets.map((t) => [t.id, t]))).map((b) => b.key);
}

/**
 * Place among the unblocked Ready tickets by rank (ADR-0058: order is priority), so 1 is the
 * card the board marks "Next". Null outside Ready or while blocked.
 */
export function queuePosition(ticket: Ticket, tickets: readonly Ticket[]): number | null {
  if (ticket.stage !== "ready") return null;
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const queue = tickets
    .filter((t) => t.stage === "ready" && !t.archived && openBlockers(t, byId).length === 0)
    .sort((a, b) => compareRanks(a.rank, b.rank));
  const i = queue.findIndex((t) => t.id === ticket.id);
  return i === -1 ? null : i + 1;
}

const RUN_VERBS: Record<RunStep, string> = {
  refine: "Refining",
  plan: "Planning",
  build: "Building",
  review: "Reviewing",
  verify: "Verifying",
  scout: "Scouting",
  sync: "Syncing with main",
};

/** "Refining · 3 min" while running; "Refine queued · 1 min" before it starts. */
export function runLabel(run: NonNullable<TicketSummary["run"]>, now: number): string {
  const since = run.startedAt ?? run.createdAt;
  const min = since ? Math.max(0, Math.floor((now - Date.parse(since)) / 60_000)) : null;
  const what =
    run.status === "queued"
      ? `${run.step[0]!.toUpperCase()}${run.step.slice(1)} queued`
      : RUN_VERBS[run.step];
  return min === null ? what : `${what} · ${min} min`;
}

/** What a ticket's status line is computed from; the UI and MCP read the same four things. */
export interface TicketFacts {
  /** The ticket's project, for blockers and its place in the queue. */
  tickets: readonly Ticket[];
  openQuestions: number;
  /** The ticket's runs, newest first. */
  runs: readonly Run[];
  /** The ticket's history, oldest first. */
  events: readonly TicketEvent[];
  /** Who does the work (ADR-0082); undefined until it loads. */
  worker?: Worker;
  /** The project's in-flight view (ADR-0080); undefined until it loads. */
  inFlight?: readonly InFlightRun[];
  /** The oldest open question's line (AI-73); only the digest passes it. */
  questionLine?: string | null;
}

const SYNC_STOP_FILES = 3;

/**
 * "sync with main stopped on a conflict in a.ts, b.ts" when the newest sync run of the ticket's
 * newest build stopped (AI-72); null otherwise. `runs` is newest first.
 */
export function syncStopped(runs: readonly Run[]): string | null {
  const sync = runs.find((r) => r.step === "sync" && r.syncRun?.outcome != null);
  const outcome = sync?.syncRun?.outcome;
  if (outcome !== "conflict_unresolved" && outcome !== "checks_failed") return null;
  // A newer build (a rework) opened another PR: that stop belongs to the old one.
  const build = runs.find((r) => r.step === "build");
  if (build && build.id !== sync!.syncRun!.buildRunId) return null;
  const files = sync!.syncRun!.conflictFiles;
  const named =
    files.length === 0
      ? ""
      : ` in ${files.slice(0, SYNC_STOP_FILES).join(", ")}${files.length > SYNC_STOP_FILES ? ", …" : ""}`;
  return outcome === "conflict_unresolved"
    ? `sync with main stopped on a conflict${named}`
    : `sync with main stopped: checks failed after the merge${named}`;
}

/** One ticket's status line: the UI's story panel and MCP `status` both call this (AI-40). */
export function ticketStatusLine(ticket: Ticket, facts: TicketFacts, now: Date) {
  return statusLine(
    {
      stage: ticket.stage,
      archived: ticket.archived,
      needsAttention: ticket.needsAttention,
      dorMet: ticket.dorStatus === "met",
      openQuestions: facts.openQuestions,
      run: facts.runs.find((r) => ACTIVE_RUN_STATUSES.includes(r.status)) ?? null,
      pr: latestPullRequest(facts.events),
      blockedBy: openBlockerKeys(ticket, facts.tickets),
      queuePosition: queuePosition(ticket, facts.tickets),
      worker: facts.worker,
      overlaps: ticket.stage === "ready" ? overlappingKey(ticket, facts.inFlight ?? []) : null,
      syncStopped: syncStopped(facts.runs),
      syncWaiting: syncWaiting(facts.runs),
      questionLine: facts.questionLine ?? null,
    },
    now,
  );
}
