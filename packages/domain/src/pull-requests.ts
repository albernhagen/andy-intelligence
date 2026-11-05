import {
  WorkTrackerError,
  type CodeHostEvent,
  type Project,
  type PullRequest,
  type Stage,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { forwardPath } from "./stages";
import type { TicketService } from "./tickets";

/**
 * Tickets follow their pull requests (AI-14, ARCHITECTURE §4.1): opened → Ready for review,
 * merged → Done, closed unmerged → In progress + Needs-you. The ticket key comes from the PR's
 * head branch or the first line of its description. PR text is untrusted data: it only ever
 * selects a ticket of the repo's own project; nothing in it is executed or followed. PRs from
 * forks are ignored: on a public repo anyone can open one.
 * Moves are by "system", one allowed step at a time, never forced.
 */

/** A ticket key inside other text, e.g. "AI-14" in "ai-14/x", "AI-14-foo" or ".../t/AI-14". */
const KEY_IN_TEXT = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]{0,9})-(\d{1,9})(?![A-Za-z0-9])/g;

/**
 * The first key in the head branch, then in the description's first line, whose prefix is the
 * project's key. Keys of other projects (or look-alikes such as "SHA-256") are skipped.
 */
export function ticketKeyFor(
  projectKey: string,
  pr: Pick<PullRequest, "headRef" | "bodyFirstLine">,
): string | null {
  for (const text of [pr.headRef, pr.bodyFirstLine]) {
    for (const [, prefix, number] of text.matchAll(KEY_IN_TEXT)) {
      if (prefix === projectKey) return `${prefix}-${number}`;
    }
  }
  return null;
}

export type PullRequestOutcome = "opened" | "merged" | "closed";

/** What a delivery means for the ticket, or null for actions that change nothing (edits, pushes). */
export function outcomeOf(
  action: string,
  pr: Pick<PullRequest, "state">,
): PullRequestOutcome | null {
  if (action === "closed") return pr.state === "merged" ? "merged" : "closed";
  if (["opened", "reopened", "ready_for_review"].includes(action) && pr.state === "open") {
    return "opened";
  }
  return null;
}

export interface PullRequestTicketResult {
  /** "ignored" when the action changes nothing or no ticket matches. */
  result: "ignored" | "linked";
  reason?: "action" | "fork" | "no_key" | "no_ticket";
  ticket?: string;
  outcome?: PullRequestOutcome;
  /** Stages the ticket moved through, in order. */
  moves?: Stage[];
  flagged?: boolean;
  /** Needs-you cleared because this PR, whose close had set it, is open again. */
  unflagged?: boolean;
}

export class PullRequestTickets {
  constructor(
    private readonly tickets: TicketService,
    private readonly tracker: WorkTracker,
  ) {}

  /** Applies one recorded `pull_request` delivery. Replays never get here (CodeEventLog). */
  async apply(
    event: Extract<CodeHostEvent, { kind: "pull_request" }>,
    project: Project,
  ): Promise<PullRequestTicketResult> {
    const pr = event.pullRequest;
    const outcome = outcomeOf(event.action, pr);
    if (!outcome) return { result: "ignored", reason: "action" };
    if (pr.fromFork) return { result: "ignored", reason: "fork" };
    const key = ticketKeyFor(project.key, pr);
    if (!key) return { result: "ignored", reason: "no_key" };
    const ticket = await this.find(key);
    if (!ticket) return { result: "ignored", reason: "no_ticket", ticket: key };

    const flaggedByThisClose = outcome === "opened" && (await this.closedLast(ticket, pr.number));
    await this.tracker.linkPullRequest(
      ticket.projectId,
      ticket.id,
      { number: pr.number, url: pr.url, state: pr.state },
      "system",
    );
    const reason = `PR #${pr.number} ${outcome}: ${pr.url}`;
    const base = { result: "linked" as const, ticket: key, outcome };

    switch (outcome) {
      case "opened": {
        const moves = pr.draft ? [] : await this.walk(ticket, "ready_for_review", reason);
        if (!flaggedByThisClose) return { ...base, moves };
        const after = await this.tickets.unflag(ticket.projectId, ticket.id, "system");
        return { ...base, moves, unflagged: !after.needsYou };
      }
      case "merged":
        // Merge means Done until M6: Dev → prod releases (ADR-0056); other bases only link.
        if (!pr.intoDefaultBranch) return { ...base, moves: [] };
        return { ...base, moves: await this.walk(ticket, "done", reason) };
      case "closed":
        return this.rework(ticket, reason, base);
    }
  }

  /** Steps forward from Ready or later; Backlog tickets (DoR not checked) only get the link. */
  private async walk(ticket: Ticket, to: Stage, reason: string): Promise<Stage[]> {
    if (ticket.stage === "backlog") return [];
    const steps = forwardPath(ticket.stage, to);
    for (const step of steps) {
      await this.tickets.move(ticket.projectId, ticket.id, step, "system", { reason });
    }
    return steps;
  }

  /**
   * Whether this PR's latest link on a flagged ticket is a close, i.e. the flag is ours to clear
   * on reopen. Flags from questions or runs are left alone.
   */
  private async closedLast(ticket: Ticket, prNumber: number): Promise<boolean> {
    if (!ticket.needsYou) return false;
    const events = await this.tracker.listEvents(ticket.projectId, ticket.id);
    const last = events.findLast((e) => e.kind === "pr_linked" && e.data.number === prNumber);
    return last?.data.state === "closed";
  }

  /** Closed unmerged: back to In progress (rework) and Needs-you, from review or later. */
  private async rework(
    ticket: Ticket,
    reason: string,
    base: PullRequestTicketResult,
  ): Promise<PullRequestTicketResult> {
    const rework = ticket.stage === "ready_for_review" || ticket.stage === "monitoring";
    if (!rework && ticket.stage !== "in_progress") return { ...base, moves: [], flagged: false };
    if (rework) {
      await this.tickets.move(ticket.projectId, ticket.id, "in_progress", "system", { reason });
    }
    await this.tickets.flag(ticket.projectId, ticket.id, "system");
    return { ...base, moves: rework ? ["in_progress"] : [], flagged: true };
  }

  private async find(key: string): Promise<Ticket | null> {
    try {
      return await this.tickets.findByKey(key);
    } catch (err) {
      if (err instanceof WorkTrackerError && err.code === "not_found") return null;
      throw err;
    }
  }
}
