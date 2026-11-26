import {
  WAITING_MERGES_MAX,
  type CodeHost,
  type Run,
  type RunStore,
  type Ticket,
  type WaitingMerge,
  type MergeQueueState,
  type WaitingMergeNote,
  type WaitingMergeQueue,
  type WaitingMerges,
  type WorkTracker,
} from "@andy/contracts";
import type { MergeQueue } from "./merge-queue";
import { ANDYS_MERGE_REASONS } from "./merge-verdict";
import { parseReleaseNote } from "./release-note";
import { ProjectTickets } from "./ticket-snapshots";

/**
 * "Waiting for your merge" (AI-218, ADR-0124): clean PRs the merge mode leaves for Andy, read
 * from what the gate already records on each build's agent task (`mergeVerdict`,
 * `verdictReasons`). A PR is listed only when Andy's merge is all that stands in its way: every
 * reason is one below. A merged or closed PR drops out (its agent task gets an outcome, and a
 * merge moves the ticket to Done).
 */

/** How long a PR's release note is reused before the description is read again. */
const NOTE_TTL_MS = 5 * 60_000;
/** Notes kept per instance; the oldest go first. */
const NOTE_CACHE_MAX = 200;

/** The ticket's latest PR from a build, when the gate left it for Andy alone; else null. */
export function waitingRun(
  runs: readonly Run[],
): (Run & { links: { pullRequest: string } }) | null {
  // Newest first: only the latest PR from a build counts.
  const latest = runs.find((r) => r.step === "build" && r.links.pullRequest);
  if (!latest?.links.pullRequest) return null;
  if (latest.outcome !== null || latest.mergeVerdict !== "wait") return null;
  const reasons = latest.verdictReasons;
  if (reasons.length === 0 || !reasons.every((r) => ANDYS_MERGE_REASONS.includes(r))) return null;
  return latest as Run & { links: { pullRequest: string } };
}

/** `owner/repo` and the number from a PR URL (`https://host/owner/repo/pull/<n>`). */
export function pullRequestRef(url: string): { repo: string; number: number } | null {
  const m = /^https:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d{1,9})$/.exec(url);
  return m ? { repo: m[1]!, number: Number(m[2]) } : null;
}

export class WaitingMergesReader {
  private readonly notes = new Map<string, { at: number; note: WaitingMergeNote | null }>();

  constructor(
    private readonly tracker: Pick<WorkTracker, "listProjects" | "listTickets">,
    private readonly runs: Pick<RunStore, "listForTicket">,
    /** Reads PR descriptions for their release notes; null: listed without a note. */
    private readonly host: Pick<CodeHost, "getPullRequestDetails"> | null,
    /** Tickets through the snapshot (AI-317), so an unchanged project costs one counter read. */
    private readonly tickets: Pick<ProjectTickets, "list"> = new ProjectTickets(tracker),
    private readonly now: () => Date = () => new Date(),
    /** Each repo's merge queue (AI-388), to show a PR's place; null: not shown. */
    private readonly queues: Pick<MergeQueue, "state"> | null = null,
  ) {}

  /** Every project's PRs waiting for Andy's merge, or one project's. */
  async read(projectId?: string): Promise<WaitingMerges> {
    const projects = (await this.tracker.listProjects()).filter(
      (p) => !projectId || p.id === projectId,
    );
    const lists = await Promise.all(projects.map((p) => this.tickets.list(p.id)));
    // Only tickets in review can have a PR waiting; the board's order is the merge order.
    const inReview = lists
      .flat()
      .filter((t) => t.stage === "ready_for_review" && !t.archived)
      .sort((a, b) => a.rank.localeCompare(b.rank) || a.key.localeCompare(b.key));
    const checked = inReview.slice(0, WAITING_MERGES_MAX);
    // One queue read per repo per call, however many of its PRs are listed.
    const queues = new Map<string, Promise<MergeQueueState | null>>();
    const found = await Promise.all(checked.map((t) => this.waitingFor(t, queues)));
    return {
      merges: found.filter((m): m is WaitingMerge => m !== null),
      truncated: inReview.length > WAITING_MERGES_MAX,
    };
  }

  private async waitingFor(
    ticket: Ticket,
    queues: Map<string, Promise<MergeQueueState | null>>,
  ): Promise<WaitingMerge | null> {
    const run = waitingRun(await this.runs.listForTicket(ticket.projectId, ticket.id));
    if (!run) return null;
    const url = run.links.pullRequest;
    const ref = pullRequestRef(url);
    if (!ref) return null;
    return {
      projectId: ticket.projectId,
      ticketKey: ticket.key,
      ticketTitle: ticket.title,
      prNumber: ref.number,
      prUrl: url,
      mergeMode: run.mergeMode,
      reasons: run.verdictReasons,
      note: await this.noteFor(url, ref),
      queue: await this.queuedAt(ref, queues),
    };
  }

  /** The PR's place in its repo's merge queue; null when not queued or the read failed. */
  private async queuedAt(
    ref: { repo: string; number: number },
    queues: Map<string, Promise<MergeQueueState | null>>,
  ): Promise<WaitingMergeQueue | null> {
    if (!this.queues) return null;
    const key = ref.repo.toLowerCase();
    let read = queues.get(key);
    if (!read) {
      read = this.queues.state(key).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            severity: "WARNING",
            message: "waiting merge: merge queue read failed",
            repo: key,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return null;
      });
      queues.set(key, read);
    }
    const q = await read;
    const at = q?.entries.findIndex((e) => e.number === ref.number) ?? -1;
    if (!q || at < 0) return null;
    return { position: at + 1, note: q.entries[at]!.lastNote };
  }

  /** The PR's release note, read at most once per `NOTE_TTL_MS` per PR. */
  private async noteFor(
    url: string,
    ref: { repo: string; number: number },
  ): Promise<WaitingMergeNote | null> {
    if (!this.host) return null;
    const at = this.now().getTime();
    const cached = this.notes.get(url);
    if (cached && at - cached.at < NOTE_TTL_MS) return cached.note;
    let note: WaitingMergeNote | null;
    try {
      const details = await this.host.getPullRequestDetails(ref.repo, ref.number);
      const parsed = details ? parseReleaseNote(details.body).note : null;
      const cut = (s: string | null | undefined) => (s ? s.slice(0, 500) : null);
      note = parsed
        ? {
            whatChanged: cut(parsed.whatChanged),
            howItWorks: cut(parsed.howItWorks),
            needsYou: cut(parsed.needsYou),
          }
        : null;
    } catch (err) {
      // Listed without its note; the next read tries again.
      console.error(
        JSON.stringify({
          severity: "WARNING",
          message: "waiting merge: release note read failed",
          pr: url,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return null;
    }
    this.notes.delete(url);
    this.notes.set(url, { at, note });
    if (this.notes.size > NOTE_CACHE_MAX) this.notes.delete(this.notes.keys().next().value!);
    return note;
  }
}
