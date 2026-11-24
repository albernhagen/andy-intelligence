import {
  notFound,
  type CodeHost,
  type EventActor,
  type GateReason,
  type MergeMode,
  type MergeWaitReason,
  type Project,
  type PullRequest,
  type ReviewFindingSource,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import {
  DomainError,
  assessChecks,
  mergeVerdict,
  openFindingsFor,
  requireCan,
  ticketKeyFor,
  ticketMergeMode,
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
 * No queue (AI-110: M5.18: Merge queue per repo orders merges). Calls for one repo run one at a
 * time within an instance, so a second call is judged after the first merged and sees itself
 * behind. Across the two instances nothing serialises them: two overlapping calls judged on the
 * same base tip can both merge, so one call at a time stays procedural until AI-110. Each call
 * also checks "head contains the latest default branch" against the base tip's sha, re-reads the
 * tip just before merging, and pins the merge to the judged head.
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
}

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "merge-pr", ...fields }));
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 2000);

export class PullRequestMerger {
  private readonly limiters = new Map<string, FixedWindowLimiter>();
  /** The last judge-and-merge per repo in this instance: the next one waits for it. */
  private readonly repoTails = new Map<string, Promise<unknown>>();

  constructor(
    private readonly tracker: WorkTracker,
    /** Null until GitHub is connected: every call is refused. */
    private readonly host: CodeHost | null,
    private readonly findings: ReviewFindingSource | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    if (!this.host) throw new DomainError("code_host_unavailable", "GitHub is not connected");

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
    return this.oneAtATime(repo, () => this.judgeAndMerge(project, repo, pr.number, actor));
  }

  /** Runs `fn` after every earlier call for `repo` in this instance has finished. */
  private async oneAtATime<T>(repo: string, fn: () => Promise<T>): Promise<T> {
    const key = repo.toLowerCase();
    const before = this.repoTails.get(key) ?? Promise.resolve();
    const mine = before.then(fn, fn);
    const tail = mine.catch(() => undefined);
    this.repoTails.set(key, tail);
    try {
      return await mine;
    } finally {
      if (this.repoTails.get(key) === tail) this.repoTails.delete(key);
    }
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

  private async judgeAndMerge(
    project: Project,
    repo: string,
    number: number,
    actor: EventActor,
  ): Promise<MergePrResult> {
    const host = this.host!;
    // Read again inside the lock: an earlier call may have changed it.
    const pr = await host.getPullRequest(repo, number);
    if (!pr) throw notFound("pull request", `${repo}#${number}`);
    if (pr.state !== "open") {
      throw new DomainError("invalid_field", `PR #${pr.number} is ${pr.state}, not open`);
    }
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
    const result: MergePrResult = {
      repo,
      number: pr.number,
      url: pr.url,
      headSha: pr.headSha,
      ticket: ticket?.key ?? null,
      mode,
      verdict: verdict.verdict,
      reasons: verdict.reasons,
      gateReasons: [...gateReasons, ...fork],
      keptFiles: verdict.keptFiles,
      highRiskFiles: verdict.highRiskFiles,
      merged: false,
      mergeSha: null,
    };
    const base = { projectId: project.id, repo, pr: pr.number, headSha: pr.headSha, actor };
    log("INFO", "merge_pr verdict", { ...base, mode, ...verdict, gateReasons: result.gateReasons });
    if (verdict.verdict !== "merge") return result;

    // The base moved since it was judged: the head may no longer contain it.
    if ((await host.branchSha(repo, pr.baseRef)) !== baseSha) {
      log("INFO", "merge_pr base moved", base);
      return { ...result, verdict: "wait", reasons: ["behind_default_branch"] };
    }
    try {
      const mergeSha = await host.mergePullRequest(repo, pr.number, pr.headSha);
      log("INFO", "merge_pr merged", { ...base, mode, mergeSha });
      await this.record(ticket, actor, mergeRecord(pr, mode, actor));
      return { ...result, merged: true, mergeSha };
    } catch (err) {
      const mergeError = errorText(err);
      log("ERROR", "merge_pr merge refused", { ...base, error: mergeError });
      await this.record(
        ticket,
        actor,
        `merge_pr didn't merge PR #${pr.number} at ${pr.headSha.slice(0, 12)} (asked by ${actor}, merge mode ${mode}, verdict merge): the host refused: ${mergeError}`,
      );
      return { ...result, mergeError };
    }
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
