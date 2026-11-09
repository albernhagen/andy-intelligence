import type {
  PullRequestLink,
  Stage,
  Ticket,
  TicketEvent,
  TicketSummary,
  Worker,
} from "@andy/contracts";
import { openBlockers as openBlockerTickets, runLabel } from "./board";
import { groupByStage } from "./tickets";

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
    const n = s.openQuestions;
    return { text: `Waiting for you: ${n} question${n === 1 ? "" : "s"}`, tone: "attention" };
  }
  if (s.needsAttention) return { text: "Waiting for you", tone: "attention" };
  // The same words as the run marker on the board card (`runLabel`, lib/board.ts).
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
      return { text: join("In progress", pr ?? "no run in flight"), tone: "default" };
    case "ready_for_review":
      return { text: join("Ready for review", pr), tone: "default" };
  }
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

/** Keys of the blockers not finished yet (the board's rule: `openBlockers` in lib/board.ts). */
export function openBlockers(ticket: Ticket, tickets: readonly Ticket[]): string[] {
  return openBlockerTickets(ticket, new Map(tickets.map((t) => [t.id, t]))).map((b) => b.key);
}

/**
 * Place among the unblocked Ready tickets by rank (ADR-0058: order is priority), so 1 is the
 * card the board marks "Next" (`nextUp`). Null outside Ready or while blocked.
 */
export function queuePosition(ticket: Ticket, tickets: readonly Ticket[]): number | null {
  if (ticket.stage !== "ready") return null;
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const queue = groupByStage(tickets.filter((t) => !t.archived)).ready.filter(
    (t) => openBlockerTickets(t, byId).length === 0,
  );
  const i = queue.findIndex((t) => t.id === ticket.id);
  return i === -1 ? null : i + 1;
}
