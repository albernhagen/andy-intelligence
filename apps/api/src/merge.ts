import {
  InMemoryMergeQueueStore,
  notFound,
  type CodeHost,
  type EventActor,
  type GateReason,
  type MergeMode,
  type MergeQueueEntry,
  type MergeWaitReason,
  type Project,
  type PullRequest,
  type ReviewFindingSource,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import {
  DomainError,
  MergeQueue,
  assessChecks,
  queueStateOf,
  mergeVerdict,
  openFindingsFor,
  requireCan,
  ticketKeyFor,
  ticketMergeMode,
  type QueueJudgement,
  type QueueMergeResult,
} from "@andy/domain";
import { FixedWindowLimiter } from "./mcp/rate-limit";

/**
 * MCP `merge_pr` (AI-220, ADR-0124): a coordinator session asks the control plane to merge one
 * session PR. The control plane reads the facts from the code host, runs `mergeVerdict` under the
 * ticket's mode (the project's, or a stricter epic or ticket override), and either squash-merges
 * with the App's identity pinned to the assessed head (the same `mergePullRequest` call the gate
 * makes) or answers `wait` with every reason. Never PR text: the description's first line only
 * selects a ticket of this project, as it does for ticket moves.
 *
 * A PR that is clean, or clean but behind, goes into the repo's merge queue (AI-110: M5.18:
 * Merge queue per repo, ADR-0150), shared with the gate and leased across instances: only the
 * queue's head merges, after a sync round when it was behind, re-judged on the latest default
 * branch and pinned to the judged head. The call answers `merged`, or `queued` with its place;
 * the queue merges it later from webhooks, and records that on the ticket.
 */

/** ADR-0028: `merge_pr` calls per project per hour, per instance (max 2 instances). */
export const MERGE_PR_HOURLY_CAP = 30;
const HOUR_MS = 60 * 60 * 1000;

/** Build agents' branches: the gate merges those PRs (ADR-0124), never `merge_pr`. */
const AGENT_BRANCH = /^agent\//;

export interface MergePrInput {
  projectId: string;
  repo: string;
  number: number;
}

export interface MergePrResult {
  repo: string;
  number: number;
  url: string;
  /** The head the verdict judged and the merge was pinned to. */
  headSha: string;
  /** The ticket the PR names whose latest linked PR is this one; null: none. */
  ticket: string | null;
  mode: MergeMode | null;
  verdict: "merge" | "wait";
  /** Empty exactly when the verdict is `merge`. */
  reasons: MergeWaitReason[];
  /** The checks, draft and branch reasons behind `gate_not_clean`. */
  gateReasons: string[];
  keptFiles: string[];
  highRiskFiles: string[];
  merged: boolean;
  /** The squash commit, when the host reported one. */
  mergeSha: string | null;
  /** Why the host refused the merge (a moved head, a conflict); absent when it didn't. */
  mergeError?: string;
  /** In the repo's merge queue (AI-110): it merges when it is the head and clean on main. */
  queued: boolean;
  /** Its place in the queue (1: next); null when not queued. */
  queuePosition: number | null;
  /** What the queue did or waits for; null when it wasn't offered. */
  queueNote: string | null;
}

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "merge-pr", ...fields }));
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 2000);

export class PullRequestMerger {
  private readonly limiters = new Map<string, FixedWindowLimiter>();
  private readonly queue: MergeQueue | null;

  constructor(
    private readonly tracker: WorkTracker,
    /** Null until GitHub is connected: every call is refused. */
    private readonly host: CodeHost | null,
    private readonly findings: ReviewFindingSource | null,
    private readonly now: () => Date = () => new Date(),
    /**
     * The merge queue shared with the gate (AI-110). Null: a queue of this merger's own, in
     * memory, which serialises one process only (tests); the API passes the shared one.
     */
    queue: MergeQueue | null = null,
  ) {
    this.queue = queue ?? (host ? new MergeQueue(new InMemoryMergeQueueStore(), host, now) : null);
    this.queue?.register("merge_pr", {
      judge: (repo, entry) => this.judgeQueued(repo, entry),
      merge: (repo, entry, headSha) => this.mergeQueued(repo, entry, headSha),
      requestSync: async (repo, entry, headSha) => {
        // Session PRs are kept current by the re-sync workflow (ADR-0111) when main moves.
        log("INFO", "merge_pr waits for the re-sync workflow", { repo, pr: entry.number, headSha });
      },
      needsYou: (repo, entry, reason) => this.queueNeedsYou(repo, entry, reason),
    });
  }

  async merge(input: MergePrInput, actor: EventActor): Promise<MergePrResult> {
    requireCan(actor, "merge_pr", input.projectId);
    const project = await this.tracker.getProject(input.projectId);
    if (!project) throw notFound("project", input.projectId);
    const repo = project.repos.find((r) => r.toLowerCase() === input.repo.toLowerCase());
    if (!repo) {
      throw new DomainError(
        "invalid_repo",
        `${input.repo} is not a repo of project ${project.key}`,
      );
    }
    this.takeCall(project);
    if (!this.host || !this.queue) {
      throw new DomainError("code_host_unavailable", "GitHub is not connected");
    }

    const pr = await this.host.getPullRequest(repo, input.number);
    if (!pr) throw notFound("pull request", `${repo}#${input.number}`);
    if (pr.state !== "open") {
      throw new DomainError("invalid_field", `PR #${pr.number} is ${pr.state}, not open`);
    }
    if (AGENT_BRANCH.test(pr.headRef)) {
      throw new DomainError(
        "invalid_field",
        `PR #${pr.number} is a build agent's PR: the gate merges it by the merge mode`,
      );
    }
    const judged = await this.evaluate(project, repo, pr);
    const base = { projectId: project.id, repo, pr: pr.number, headSha: pr.headSha, actor };
    log("INFO", "merge_pr verdict", {
      ...base,
      mode: judged.result.mode,
      ...judged.verdict,
      gateReasons: judged.result.gateReasons,
      queueState: judged.state,
    });
    if (judged.state !== "merge" && judged.state !== "behind") return judged.result;

    // AI-110: the merge queue merges it when it is the repo's head and clean on the latest main.
    const offered = await this.queue.offer(repo, {
      projectId: project.id,
      number: pr.number,
      kind: "merge_pr",
      actor,
      headSha: pr.headSha,
    });
    if (offered.result === "merged") {
      return {
        ...judged.result,
        headSha: offered.headSha,
        verdict: "merge",
        reasons: [],
        merged: true,
        mergeSha: offered.sha,
      };
    }
    if (offered.result === "dropped") {
      return { ...judged.result, queueNote: `dropped from the merge queue: ${offered.reason}` };
    }
    return {
      ...judged.result,
      queued: true,
      queuePosition: offered.position,
      queueNote: offered.reason,
    };
  }

  /** ADR-0028: refuses past the hourly cap; every call counts, waits included. */
  private takeCall(project: Project): void {
    let limiter = this.limiters.get(project.id);
    if (!limiter) {
      limiter = new FixedWindowLimiter(MERGE_PR_HOURLY_CAP, HOUR_MS, () => this.now().getTime());
      this.limiters.set(project.id, limiter);
    }
    if (limiter.tryTake()) return;
    log("WARNING", "merge_pr cap reached", { projectId: project.id });
    throw new DomainError(
      "rate_limited",
      `merge_pr is capped at ${MERGE_PR_HOURLY_CAP} calls per project per hour; try again later`,
    );
  }

  /** The verdict for the PR's head, judged on the default branch's current tip. */
  private async evaluate(project: Project, repo: string, pr: PullRequest) {
    const host = this.host!;
    const ticket = await this.ticketOf(project, pr);
    const [files, required, checks, baseSha] = await Promise.all([
      host.listChangedFiles(repo, pr.number),
      host.listRequiredChecks(repo, pr.baseRef),
      host.listHeadChecks(repo, pr.headSha),
      host.branchSha(repo, pr.baseRef),
    ]);
    const gateReasons: GateReason[] = [
      ...(pr.draft ? (["draft"] as const) : []),
      ...(pr.intoDefaultBranch ? [] : (["not_default_branch"] as const)),
      ...assessChecks(required, checks).reasons,
    ];
    const fork = pr.fromFork ? ["from_fork"] : [];
    const mode = ticket ? await ticketMergeMode(this.tracker, project, ticket) : project.mergeMode;
    const verdict = mergeVerdict(
      {
        gateClean: gateReasons.length === 0 && fork.length === 0,
        files,
        labels: pr.labels ?? null,
        upToDate: baseSha ? await this.upToDate(repo, pr, baseSha) : null,
        openFindings: await openFindingsFor(this.findings, project.id, repo, pr, "merge-pr"),
        readyForReview: ticket?.stage === "ready_for_review",
      },
      mode,
    );
    const allGateReasons = [...gateReasons, ...fork];
    const result: MergePrResult = {
      repo,
      number: pr.number,
      url: pr.url,
      headSha: pr.headSha,
      ticket: ticket?.key ?? null,
      mode,
      verdict: verdict.verdict,
      reasons: verdict.reasons,
      gateReasons: allGateReasons,
      keptFiles: verdict.keptFiles,
      highRiskFiles: verdict.highRiskFiles,
      merged: false,
      mergeSha: null,
      queued: false,
      queuePosition: null,
      queueNote: null,
    };
    return { result, verdict, baseSha, state: queueStateOf(verdict, allGateReasons), ticket };
  }

  /** The queue's judge for a session PR: the same verdict as a call. */
  private async judgeQueued(repo: string, entry: MergeQueueEntry): Promise<QueueJudgement> {
    const found = await this.queuedPr(repo, entry);
    if ("gone" in found) return { state: "gone", detail: found.gone };
    const { project, pr } = found;
    const judged = await this.evaluate(project, repo, pr);
    const reasons = [...judged.verdict.reasons, ...judged.result.gateReasons];
    if (judged.state === "merge") {
      return { state: "merge", headSha: pr.headSha, baseRef: pr.baseRef, baseSha: judged.baseSha! };
    }
    if (judged.state === "behind") return { state: "behind", headSha: pr.headSha };
    return { state: judged.state, headSha: pr.headSha, reasons };
  }

  /**
   * The queue's merge of its head: the App's squash merge pinned to `headSha`, recorded on the
   * PR's ticket with who asked (ADR-0124 "Record").
   */
  private async mergeQueued(
    repo: string,
    entry: MergeQueueEntry,
    headSha: string,
  ): Promise<QueueMergeResult> {
    const found = await this.queuedPr(repo, entry);
    if ("gone" in found) return { merged: false, error: found.gone };
    const { project, pr } = found;
    if (pr.headSha !== headSha) return { merged: false, error: "head moved" };
    const actor = entry.enqueuedBy as EventActor;
    const ticket = await this.ticketOf(project, pr);
    const mode = ticket ? await ticketMergeMode(this.tracker, project, ticket) : project.mergeMode;
    const base = { projectId: project.id, repo, pr: pr.number, headSha, actor };
    try {
      const mergeSha = await this.host!.mergePullRequest(repo, pr.number, headSha);
      log("INFO", "merge_pr merged", { ...base, mode, mergeSha });
      await this.record(ticket, actor, mergeRecord(pr, mode, actor));
      return { merged: true, sha: mergeSha };
    } catch (err) {
      const mergeError = errorText(err);
      log("ERROR", "merge_pr merge refused", { ...base, error: mergeError });
      await this.record(
        ticket,
        actor,
        `merge_pr didn't merge PR #${pr.number} at ${headSha.slice(0, 12)} (asked by ${actor}, merge mode ${mode}, verdict merge): the host refused: ${mergeError}`,
      );
      return { merged: false, error: mergeError };
    }
  }

  /** Andy's Needs-you inbox: the PR's ticket is flagged with the queue's reason. */
  private async queueNeedsYou(repo: string, entry: MergeQueueEntry, reason: string) {
    const found = await this.queuedPr(repo, entry);
    const ticket = "gone" in found ? null : await this.ticketOf(found.project, found.pr);
    if (!ticket) {
      log("WARNING", "merge queue drop with no ticket to flag", { repo, pr: entry.number, reason });
      return;
    }
    await this.tracker.updateTicket(
      ticket.projectId,
      ticket.id,
      { fields: { needsAttention: true } },
      "system",
    );
    await this.record(
      ticket,
      "system",
      `Needs you: the merge queue dropped PR #${entry.number} (asked by ${entry.enqueuedBy}): ${reason}. Call merge_pr again once it is clean on the latest default branch, or merge it yourself.`,
    );
  }

  private async queuedPr(
    repo: string,
    entry: MergeQueueEntry,
  ): Promise<{ gone: string } | { project: Project; pr: PullRequest }> {
    const project = await this.tracker.getProject(entry.projectId);
    if (!project) return { gone: `project ${entry.projectId} is gone` };
    const pr = await this.host!.getPullRequest(repo, entry.number);
    if (!pr || pr.state !== "open") {
      return { gone: `PR #${entry.number} is ${pr?.state ?? "not found"}` };
    }
    if (AGENT_BRANCH.test(pr.headRef)) return { gone: `PR #${entry.number} is a build agent's PR` };
    return { project, pr };
  }

  /**
   * The ticket the PR names (head branch, then the description's first line), only when its
   * latest linked PR is this one: PR text can name any ticket, but the link is recorded from
   * GitHub's own PR events, so a PR can't borrow another PR's ticket in Ready for review.
   */
  private async ticketOf(project: Project, pr: PullRequest): Promise<Ticket | null> {
    const key = ticketKeyFor(project.key, pr);
    const ticket = key ? await this.tracker.getTicketByKey(project.id, key) : null;
    if (!ticket) return null;
    const linked = await this.tracker.getLatestPullRequest(project.id, ticket.id);
    return linked?.number === pr.number && linked.url === pr.url ? ticket : null;
  }

  /** Whether the head contains the base tip that was read; null (wait) when the host can't say. */
  private async upToDate(repo: string, pr: PullRequest, baseSha: string): Promise<boolean | null> {
    try {
      return await this.host!.headContains(repo, pr.headSha, baseSha);
    } catch (err) {
      log("WARNING", "up-to-date check failed", { pr: pr.number, error: errorText(err) });
      return null;
    }
  }

  /**
   * ADR-0124 "Record": the merge, who asked, the mode and the verdict, on the PR's ticket. A
   * failed write is logged, never thrown: the merge already happened.
   */
  private async record(ticket: Ticket | null, actor: EventActor, body: string): Promise<void> {
    if (!ticket) return;
    try {
      await this.tracker.addComment(ticket.projectId, ticket.id, body, actor);
    } catch (err) {
      log("ERROR", "merge_pr record failed", { ticket: ticket.key, error: errorText(err) });
    }
  }
}

function mergeRecord(pr: PullRequest, mode: MergeMode | null, actor: EventActor): string {
  return `merge_pr merged PR #${pr.number} at ${pr.headSha.slice(0, 12)}, asked by ${actor}, under merge mode ${mode}: verdict merge (every check and both reviews passed on that head, and it contains the latest default branch).`;
}
