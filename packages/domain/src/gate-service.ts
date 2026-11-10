import {
  WorkTrackerError,
  type CodeHost,
  type CodeHostEvent,
  type Project,
  type PullRequest,
  type Run,
  type RunMetrics,
  type RunOutcome,
  type RunStore,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import {
  CODEOWNERS_PATHS,
  codeownersGlobs,
  decideGate,
  policyAllows,
  type GateDecision,
} from "./gate";
import { syncPendingFor } from "./sync-runs";
import type { TicketService } from "./tickets";

/**
 * Applies the gate to agent PRs (AI-34: workflow.md §4.5, ADR-0050, ADR-0040). On each PR or
 * finished-check delivery it re-reads the PR's current state from the host, records what the gate
 * decides on the Run, and merges when the project's policy allows. On close it records outcome and
 * metrics. Only PRs on a build run's own branch are touched. Every failure leaves the PR unmerged.
 */

const AGENT_BRANCH = /^agent\/([A-Z][A-Z0-9]{0,9}-\d+)\/([^/]+)$/;
/** A check can name several PRs; each costs host reads (ADR-0028). */
const MAX_PRS_PER_CHECK = 3;
const MAX_LISTED_FILES = 20;

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "gate", ...fields }));
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 2000);

export interface GateResult {
  result: "ignored" | "assessed" | "merged" | "merge_failed" | "closed" | "reverted";
  pr?: number;
  runId?: string;
  outcome?: RunOutcome;
}

interface AgentPr {
  run: Run;
  ticket: Ticket;
}

export class PullRequestGate {
  constructor(
    private readonly host: CodeHost,
    private readonly tracker: WorkTracker,
    private readonly runs: RunStore,
    private readonly tickets: TicketService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** One recorded delivery. Replays never get here; a second delivery of a close is a no-op. */
  async apply(event: CodeHostEvent, project: Project): Promise<GateResult[]> {
    if (event.kind === "check_run") {
      if (event.action !== "completed") return [];
      const results: GateResult[] = [];
      for (const n of event.checkRun.pullRequestNumbers.slice(0, MAX_PRS_PER_CHECK)) {
        results.push(await this.review(event.repo, n, project));
      }
      return results;
    }
    if (event.kind !== "pull_request") return [];
    const pr = event.pullRequest;
    if (event.action === "closed") return this.closed(event.repo, pr, project);
    if (["opened", "reopened", "synchronize", "ready_for_review"].includes(event.action)) {
      if (event.action === "reopened") await this.clearFailedOutcome(pr, project);
      return [await this.review(event.repo, pr.number, project)];
    }
    return [];
  }

  private async review(repo: string, number: number, project: Project): Promise<GateResult> {
    const pr = await this.host.getPullRequest(repo, number);
    if (!pr || pr.state !== "open") return { result: "ignored", pr: number };
    const agent = await this.agentPr(pr, project);
    if (!agent || agent.run.outcome) return { result: "ignored", pr: number };

    const decision = await this.assess(repo, pr, agent.run);
    const run = await this.runs.update(
      agent.run.id,
      {
        wouldAutoMerge: decision.wouldAutoMerge,
        gateReasons: decision.reasons,
        protectedFiles: decision.protectedFiles,
        metrics: progress(agent.run.metrics, decision, pr.headSha),
      },
      ["succeeded"],
    );
    const base = { pr: number, runId: run.id };
    log("INFO", "gate assessed", { ...base, reasons: decision.reasons });
    if (decision.flag) await this.flagOnce(run, agent.ticket, decision);
    if (!decision.wouldAutoMerge) return { result: "assessed", ...base };

    // The repo index caches projects for a minute: read the policy now.
    const policy = (await this.tracker.getProject(project.id))?.autoMerge ?? "none";
    if (!policyAllows(policy, agent.ticket.size) || agent.ticket.stage !== "ready_for_review") {
      return { result: "assessed", ...base };
    }
    return this.merge(repo, pr, run, agent.ticket);
  }

  /**
   * One attempt per head commit: the claim is atomic, and a failure is left to Andy (no retry). A
   * new commit is a new head, assessed afresh.
   */
  private async merge(
    repo: string,
    pr: PullRequest,
    run: Run,
    ticket: Ticket,
  ): Promise<GateResult> {
    const base = { pr: pr.number, runId: run.id };
    if (run.mergeAttemptedSha === pr.headSha) return { result: "assessed", ...base };
    try {
      await this.runs.update(run.id, { mergeAttemptedSha: pr.headSha }, ["succeeded"]);
    } catch (err) {
      if (err instanceof WorkTrackerError && err.code === "conflict") {
        return { result: "assessed", ...base };
      }
      throw err;
    }
    try {
      await this.host.mergePullRequest(repo, pr.number, pr.headSha);
    } catch (err) {
      const mergeError = errorText(err);
      log("ERROR", "auto-merge failed", { ...base, error: mergeError });
      await this.runs.update(run.id, { mergeError }, ["succeeded"]);
      await this.tickets.flag(ticket.projectId, ticket.id, "system");
      await this.tracker.addComment(
        ticket.projectId,
        ticket.id,
        `Auto-merge of PR #${pr.number} failed; it waits for you: ${mergeError}`,
        "system",
      );
      return { result: "merge_failed", ...base };
    }
    log("INFO", "auto-merged", base);
    return { result: "merged", ...base };
  }

  private async closed(repo: string, pr: PullRequest, project: Project): Promise<GateResult[]> {
    const results: GateResult[] = [];
    if (pr.state === "merged") {
      const reverted = await this.markReverted(repo, pr, project);
      if (reverted) results.push(reverted);
    }
    const agent = await this.agentPr(pr, project);
    if (!agent || agent.run.outcome) return results;
    const { run, ticket } = agent;

    let decision: GateDecision | null = null;
    try {
      decision = await this.assess(repo, pr, run);
    } catch (err) {
      log("WARNING", "gate read failed at close", { runId: run.id, error: errorText(err) });
    }
    const andyCommits = await this.countAndyCommits(repo, pr, run);
    const metrics = await this.finalMetrics(run, ticket, pr, decision, andyCommits);
    const outcome = outcomeOf(pr.state === "merged", metrics);
    await this.runs.update(
      run.id,
      {
        outcome,
        metrics,
        ...(decision
          ? {
              wouldAutoMerge: decision.wouldAutoMerge,
              gateReasons: decision.reasons,
              protectedFiles: decision.protectedFiles,
            }
          : {}),
      },
      ["succeeded"],
    );
    log("INFO", "run outcome recorded", { pr: pr.number, runId: run.id, outcome });
    results.push({ result: "closed", pr: pr.number, runId: run.id, outcome });
    return results;
  }

  private async finalMetrics(
    run: Run,
    ticket: Ticket,
    pr: PullRequest,
    decision: GateDecision | null,
    andyCommits: number | null,
  ): Promise<RunMetrics> {
    const seen = decision ? progress(run.metrics, decision, pr.headSha) : emptyOr(run.metrics);
    const events = await this.tracker.listEvents(ticket.projectId, ticket.id);
    const reworks = events.filter(
      (e) =>
        e.kind === "stage_changed" &&
        e.data.from === "ready_for_review" &&
        e.data.to === "in_progress" &&
        e.createdAt >= (run.createdAt ?? ""),
    ).length;
    return {
      ...seen,
      ciGreenFirstTry: seen.ciGreenFirstTry ?? (pr.state === "merged" ? true : null),
      reviewBlockers: seen.reviewFailures.length,
      andyCommits,
      reworks,
      costEstimateUsd: run.costUsd,
    };
  }

  private async countAndyCommits(repo: string, pr: PullRequest, run: Run): Promise<number | null> {
    try {
      const commits = await this.host.listPullRequestCommits(repo, pr.number);
      if (!commits.complete) return null;
      return commits.items.filter((c) => !c.author?.endsWith("[bot]")).length;
    } catch (err) {
      log("WARNING", "commits read failed at close", { runId: run.id, error: errorText(err) });
      return null;
    }
  }

  /** A merged revert PR (GitHub's own branch name or first line) marks the original run. */
  private async markReverted(
    repo: string,
    pr: PullRequest,
    project: Project,
  ): Promise<GateResult | null> {
    if (!pr.intoDefaultBranch || pr.fromFork) return null;
    const number = revertedPullRequest(pr);
    if (number === null) return null;
    const original = await this.host.getPullRequest(repo, number);
    if (!original || original.state !== "merged") return null;
    const agent = await this.agentPr(original, project);
    if (!agent) return null;
    const { outcome } = agent.run;
    if (outcome !== "merged_clean" && outcome !== "reworked") return null;
    await this.runs.update(agent.run.id, { outcome: "reverted" }, ["succeeded"]);
    log("INFO", "run outcome reverted", { pr: number, runId: agent.run.id, by: pr.number });
    return { result: "reverted", pr: number, runId: agent.run.id, outcome: "reverted" };
  }

  /** A reopened PR is live again, so "closed unmerged" no longer describes it. */
  private async clearFailedOutcome(pr: PullRequest, project: Project): Promise<void> {
    const agent = await this.agentPr(pr, project);
    if (agent?.run.outcome === "failed") {
      await this.runs.update(agent.run.id, { outcome: null }, ["succeeded"]);
    }
  }

  private async assess(repo: string, pr: PullRequest, run: Run): Promise<GateDecision> {
    const [files, codeowners, required, checks, active] = await Promise.all([
      this.host.listChangedFiles(repo, pr.number),
      // The base branch's file: a PR can't unprotect a path by editing CODEOWNERS.
      Promise.all(CODEOWNERS_PATHS.map((p) => this.host.readFile(repo, p, pr.baseRef))),
      this.host.listRequiredChecks(repo, pr.baseRef),
      this.host.listHeadChecks(repo, pr.headSha),
      this.runs.listActive(run.projectId),
    ]);
    return decideGate({
      verification: run.verification,
      draft: pr.draft,
      intoDefaultBranch: pr.intoDefaultBranch,
      files,
      codeowners: codeowners.flatMap((text) => (text === null ? [] : codeownersGlobs(text))),
      required,
      checks,
      // AI-72 (ADR-0083): never merge a head a queued or running sync run is about to replace.
      syncPending: syncPendingFor(run, active, this.now()),
    });
  }

  private async flagOnce(run: Run, ticket: Ticket, decision: GateDecision): Promise<void> {
    if (run.gateFlaggedAt) return;
    await this.runs.update(run.id, { gateFlaggedAt: this.now().toISOString() }, ["succeeded"]);
    await this.tickets.flag(ticket.projectId, ticket.id, "system");
    const files = decision.protectedFiles.slice(0, MAX_LISTED_FILES).join(", ");
    await this.tracker.addComment(
      ticket.projectId,
      ticket.id,
      `The PR won't auto-merge (${decision.reasons.join(", ")})${files ? `: ${files}` : ""}.`,
      "system",
    );
  }

  /** The build run that owns this PR, or null for anything else (human PRs, forks, look-alikes). */
  private async agentPr(pr: PullRequest, project: Project): Promise<AgentPr | null> {
    const m = AGENT_BRANCH.exec(pr.headRef);
    if (!m || pr.fromFork) return null;
    const run = await this.runs.get(m[2]!);
    if (
      !run?.ticketId ||
      run.projectId !== project.id ||
      run.step !== "build" ||
      run.status !== "succeeded" ||
      run.branch !== pr.headRef ||
      run.links.pullRequest !== pr.url
    ) {
      log("WARNING", "agent-style branch without its run", { pr: pr.number, headRef: pr.headRef });
      return null;
    }
    const ticket = await this.tracker.getTicket(run.projectId, run.ticketId);
    return ticket && ticket.key === m[1] ? { run, ticket } : null;
  }
}

/** Failures seen so far stay seen: a later green rerun doesn't erase them. */
function progress(prior: RunMetrics | null, decision: GateDecision, sha: string): RunMetrics {
  const seen = emptyOr(prior);
  return {
    ...seen,
    ciGreenFirstTry: seen.ciGreenFirstTry === false || decision.ciFailed ? false : null,
    reviewFailures: [
      ...new Set([...seen.reviewFailures, ...decision.failedReviews.map((n) => `${n}@${sha}`)]),
    ].slice(0, 50),
  };
}

function emptyOr(metrics: RunMetrics | null): RunMetrics {
  return (
    metrics ?? {
      ciGreenFirstTry: null,
      reviewFailures: [],
      reviewBlockers: null,
      andyCommits: null,
      reworks: null,
      costEstimateUsd: null,
    }
  );
}

function outcomeOf(merged: boolean, metrics: RunMetrics): RunOutcome {
  if (!merged) return "failed";
  return (metrics.andyCommits ?? 0) === 0 && metrics.reviewBlockers === 0
    ? "merged_clean"
    : "reworked";
}

/** The PR a revert PR undoes, from GitHub's `revert-<n>-…` branch or "Reverts owner/repo#<n>". */
export function revertedPullRequest(pr: Pick<PullRequest, "headRef" | "bodyFirstLine">) {
  const m =
    /^revert-(\d{1,9})-/.exec(pr.headRef) ?? /^Reverts \S+#(\d{1,9})\b/.exec(pr.bodyFirstLine);
  return m ? Number(m[1]) : null;
}
