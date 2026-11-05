import type { PullRequestLink, Run, RunStep, Stage, Ticket, TicketEvent } from "@andy/contracts";
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
  run: Pick<Run, "step" | "status" | "startedAt" | "createdAt"> | null;
  /** The latest pull request linked to the ticket. */
  pr: Pick<PullRequestLink, "number" | "state"> | null;
  /** Keys of the blockers that are not Done or Cancelled yet. */
  blockedBy: string[];
  /** 1-based place in the Ready lane; null outside Ready. */
  queuePosition: number | null;
}

const STEP_VERBS: Record<RunStep, string> = {
  refine: "Refining",
  plan: "Planning",
  build: "Building",
  review: "Reviewing",
  verify: "Verifying",
  scout: "Scouting",
};

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
  if (s.run) {
    const verb = STEP_VERBS[s.run.step];
    const started = s.run.startedAt ?? s.run.createdAt;
    const when = s.run.status === "queued" || !started ? "queued" : elapsed(new Date(started), now);
    return { text: join(verb, when, pr), tone: "running" };
  }
  if (s.blockedBy.length > 0) return { text: `Blocked by ${list(s.blockedBy)}`, tone: "danger" };

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
    case "monitoring":
      return { text: join("Monitoring", pr), tone: "success" };
  }
}

/** "1 min" at least, so a run that just started never reads "0 min". */
export function elapsed(from: Date, now: Date): string {
  const minutes = Math.max(1, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
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

/** Blockers not finished yet, by key; one outside the loaded tickets shows as "another ticket". */
export function openBlockers(ticket: Ticket, tickets: readonly Ticket[]): string[] {
  return ticket.blockedBy.flatMap((id) => {
    const b = tickets.find((t) => t.id === id);
    if (!b) return ["another ticket"];
    return b.stage === "done" || b.stage === "cancelled" ? [] : [b.key];
  });
}

/** Place in the Ready lane by rank (ADR-0058: order is priority); null outside Ready. */
export function queuePosition(ticket: Ticket, tickets: readonly Ticket[]): number | null {
  if (ticket.stage !== "ready") return null;
  const lane = groupByStage(tickets.filter((t) => !t.archived)).ready;
  const i = lane.findIndex((t) => t.id === ticket.id);
  return i === -1 ? null : i + 1;
}
