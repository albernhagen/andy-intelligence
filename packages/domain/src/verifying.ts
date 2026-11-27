import type {
  ChangedFile,
  Listing,
  Project,
  Ticket,
  WatchdogQueue,
  WorkTracker,
} from "@andy/contracts";

/**
 * The Verifying stage (AI-181: M6.5, ADR-0114): Ready for review → Verifying → Done for every
 * project whose `deployKind` is not `none`. No per-project opt-out.
 */

/**
 * The one system-wide switch. Off: a merge moves its ticket to Done as before, for every project.
 * On since AI-188: M6.7: Verification run, whose verify task moves tickets out of Verifying
 * (ADR-0159). Andy turned it on by merging that PR; turning it off is a one-line revert to false
 * (runbook `verification.md`), after which tickets already in Verifying are moved by hand.
 */
export const VERIFYING_SWITCH = true;

/** A ticket in Verifying this long is flagged Needs-you (ADR-0114). */
export const VERIFYING_NEEDS_YOU_MS = 2 * 60 * 60 * 1000;

/**
 * Paths that never deploy: the same `paths-ignore` as `.github/workflows/deploy.yml`
 * (`docs/**`, `infra/**`, `**.md`).
 */
export function isNonDeployPath(path: string): boolean {
  return path.startsWith("docs/") || path.startsWith("infra/") || path.endsWith(".md");
}

/**
 * Whether a merged PR's changes can't start a deploy, so its ticket goes straight to Done: every
 * changed path (and a rename's old path) is docs or `infra/`. A listing that was cut short can't
 * prove that, so it verifies.
 */
export function skipsVerifying(files: Listing<ChangedFile>): boolean {
  if (!files.complete) return false;
  return files.items.every(
    (f) => isNonDeployPath(f.path) && (f.previousPath === null || isNonDeployPath(f.previousPath)),
  );
}

/** Whether a merge in this project may go to Verifying at all (before reading its files). */
export function verifiesMerges(switchOn: boolean, project: Pick<Project, "deployKind">): boolean {
  return switchOn && project.deployKind !== "none";
}

export type VerifyingCheckOutcome =
  /** Still in Verifying after 2 hours: flagged Needs-you, with a comment. */
  | "flagged"
  /** Still in Verifying and already flagged: nothing to do. */
  | "already_flagged"
  /** It left Verifying (verified, sent back, moved by hand, cancelled). */
  | "left"
  /** It entered Verifying again since: that entry's own check decides. */
  | "superseded"
  /** Delivered before the 2 hours were up: the queue retries it. */
  | "early"
  | "not_found";

/** How far before its due time a delivery counts as early (and is retried) rather than stale. */
const EARLY_SLACK_MS = 5 * 60 * 1000;

/**
 * The 2-hour Needs-you check (ADR-0114), on the run watchdog's queue (ARCHITECTURE §7.1): one
 * delayed check per entry into Verifying, so nothing polls and the queue's caps apply. A late,
 * replayed or stale delivery changes nothing.
 */
export class VerifyingChecks {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly queue: Pick<WatchdogQueue, "scheduleCheck"> | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Queues the ticket's check 2 hours from now. Logs and swallows a queue failure. */
  async entered(ticket: Pick<Ticket, "projectId" | "id" | "key">): Promise<void> {
    if (!this.queue) {
      log("WARNING", "verifying check not queued: no watchdog queue", { ticket: ticket.key });
      return;
    }
    const at = new Date(this.now().getTime() + VERIFYING_NEEDS_YOU_MS).toISOString();
    try {
      await this.queue.scheduleCheck({
        kind: "verifying",
        projectId: ticket.projectId,
        ticketId: ticket.id,
        at,
      });
    } catch (err) {
      log("ERROR", "verifying check not queued", { ticket: ticket.key, error: String(err) });
    }
  }

  /** The queue's delivery: flags the ticket when it has been in Verifying for 2 hours. */
  async check(projectId: string, ticketId: string): Promise<VerifyingCheckOutcome> {
    const ticket = await this.tracker.getTicket(projectId, ticketId);
    if (!ticket) return "not_found";
    if (ticket.stage !== "verifying") return "left";
    const events = await this.tracker.listEvents(projectId, ticketId);
    const entry = events.findLast((e) => e.kind === "stage_changed" && e.data.to === "verifying");
    const enteredAt = entry ? Date.parse(entry.createdAt) : Date.parse(ticket.updatedAt);
    const left = enteredAt + VERIFYING_NEEDS_YOU_MS - this.now().getTime();
    if (left > EARLY_SLACK_MS) return "superseded";
    if (left > 0) return "early";
    if (ticket.needsAttention) return "already_flagged";
    await this.tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { needsAttention: true } },
      "system",
    );
    await this.tracker.addComment(
      projectId,
      ticketId,
      "In Verifying for over 2 hours: check the deploy and the verify task, or move the ticket by hand.",
      "system",
    );
    return "flagged";
  }
}

function log(severity: "WARNING" | "ERROR", message: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ severity, message, component: "verifying", ...fields }));
}
