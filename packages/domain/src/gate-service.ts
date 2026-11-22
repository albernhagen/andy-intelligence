import {
  WorkTrackerError,
  type ChangedFile,
  type CodeHost,
  type CodeHostEvent,
  type Project,
  type PullRequest,
  type Run,
  type RunMetrics,
  type RunOutcome,
  type Listing,
  type MergeMode,
  type ReviewFindingSource,
  type RunStore,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { CODEOWNERS_PATHS, codeownersGlobs, decideGate, type GateDecision } from "./gate";
import { effectiveTicketMergeMode } from "./merge-mode";
import { mergeVerdict, openFindingsOn, type MergeVerdict } from "./merge-verdict";
import { cascadesFrom } from "./overrides";
import { intoEpicBranch, passesIntoEpic, type EpicMerges } from "./night-merge";
import { syncPendingFor } from "./sync-runs";
import type { NightUnattended } from "./night-unattended";
import type { TicketService } from "./tickets";

/**
 * Applies the gate to agent PRs (AI-34: workflow.md §4.5, ADR-0050, ADR-0040). On each PR or
 * finished-check delivery it re-reads the PR's current state from the host, records what the gate
 * decides on the Run, and merges when the merge verdict under the project's mode says so
 * (ADR-0124, AI-215; a project with no mode saved merges nothing, ADR-0134). On close it records outcome and
 * metrics. Only PRs on a build run's own branch are touched. Every failure leaves the PR unmerged.
 * A night story's PR into its launch's `epic/<KEY>` branch merges there when the gate's only
 * reason is `not_default_branch`, whatever the policy, and the story moves to Done (AI-124,
 * ADR-0107); its required checks and CODEOWNERS are read from the default branch.
 */

const AGENT_BRANCH = /^agent\/([A-Z][A-Z0-9]{0,9}-\d+)\/([^/]+)$/;
/** A check can name several PRs; each costs host reads (ADR-0028). */
const MAX_PRS_PER_CHECK = 3;
const MAX_LISTED_FILES = 20;
/** Review findings read per verdict (ADR-0028): the project's latest reviewed PRs only. */
const FINDING_PULLS = 30;
const FINDING_LIMIT = 300;

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
    /** Night launches (AI-123): a vetoed PR stops its story for the night; null: none. */
    private readonly night: NightUnattended | null = null,
    /** Night launches' epic branches (AI-124); null: PRs into them never merge. */
    private readonly epicMerges: EpicMerges | null = null,
    /**
     * Review findings recorded per PR head (ADR-0097), optional. Null: the review checks are the
     * record, since they fail on any open blocker, should-fix, high or critical finding (ADR-0134).
     */
    private readonly findings: ReviewFindingSource | null = null,
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

    const { decision, files } = await this.assess(repo, pr, agent.run, agent.ticket);
    // Into the default branch: the merge verdict for this head (vetoed heads too, as
    // gate_not_clean), recorded in the same write as the gate's facts so the Run never shows an
    // older head's verdict.
    const judged = pr.intoDefaultBranch
      ? await this.verdictFor(repo, pr, agent.ticket, project, decision.wouldAutoMerge, files)
      : null;
    const run = await this.runs.update(
      agent.run.id,
      {
        wouldAutoMerge: decision.wouldAutoMerge,
        gateReasons: decision.reasons,
        protectedFiles: decision.protectedFiles,
        outsideDocs: decision.outsideDocs,
        metrics: progress(agent.run.metrics, decision, pr.headSha),
        ...(judged
          ? {
              mergeMode: judged.mode,
              mergeVerdict: judged.verdict.verdict,
              verdictReasons: judged.verdict.reasons,
            }
          : {}),
      },
      ["succeeded"],
    );
    const base = { pr: number, runId: run.id };
    log("INFO", "gate assessed", { ...base, reasons: decision.reasons });
    if (judged) log("INFO", "merge verdict", { ...base, mode: judged.mode, ...judged.verdict });
    if (decision.flag) {
      await this.flagOnce(run, agent.ticket, decision);
      await this.night?.stopStory(
        agent.ticket.projectId,
        agent.ticket.id,
        `the merge gate vetoed its PR #${pr.number}: ${decision.reasons.join(", ")}`,
      );
    }
    // `wouldAutoMerge` needs the default branch, so a PR into an epic branch never takes it.
    if (!decision.wouldAutoMerge) {
      const launch =
        this.epicMerges && passesIntoEpic(decision)
          ? await this.epicMerges.target(pr, run, agent.ticket)
          : null;
      if (launch) return this.merge(repo, pr, run, agent.ticket, launch.epicKey);
      return { result: "assessed", ...base };
    }
    if (judged?.verdict.verdict !== "merge") return { result: "assessed", ...base };
    return this.merge(repo, pr, run, agent.ticket, null, judged.mode);
  }

  /**
   * The merge verdict for the PR's head. The mode is the ticket's: the stricter of the project's
   * saved mode and any ticket or epic override (`effectiveTicketMergeMode`); a project with no
   * saved mode stays unset, so nothing merges (ADR-0134).
   */
  private async verdictFor(
    repo: string,
    pr: PullRequest,
    ticket: Ticket,
    project: Project,
    gateClean: boolean,
    files: Listing<ChangedFile>,
  ): Promise<{ mode: MergeMode | null; verdict: MergeVerdict }> {
    // The repo index caches projects for a minute: read the mode now.
    const fresh = (await this.tracker.getProject(project.id)) ?? project;
    const mode = await this.ticketMode(fresh, ticket);
    const verdict = mergeVerdict(
      {
        gateClean,
        files,
        labels: pr.labels ?? null,
        upToDate: await this.upToDate(repo, pr),
        openFindings: await this.openFindings(project.id, repo, pr),
        readyForReview: ticket.stage === "ready_for_review",
      },
      mode,
    );
    return { mode, verdict };
  }

  /** The ticket's mode: the stricter of the project's, its own override and its epic's. */
  private async ticketMode(project: Project, ticket: Ticket): Promise<MergeMode | null> {
    if (project.mergeMode === null) return null;
    const epic = ticket.parentId
      ? cascadesFrom(await this.tracker.getTicket(ticket.projectId, ticket.parentId))
      : null;
    const withEpic = effectiveTicketMergeMode(project, epic?.overrides.mergeMode);
    return effectiveTicketMergeMode({ mergeMode: withEpic }, ticket.overrides.mergeMode);
  }

  /** Whether the head contains the default branch's tip; null (wait) when the host can't say. */
  private async upToDate(repo: string, pr: PullRequest): Promise<boolean | null> {
    try {
      return await this.host.headContains(repo, pr.headSha, pr.baseRef);
    } catch (err) {
      log("WARNING", "up-to-date check failed", { pr: pr.number, error: errorText(err) });
      return null;
    }
  }

  /**
   * Open findings recorded for this head. Without a source, 0: the review checks fail on every
   * open finding (ADR-0134, Andy's answer (a)), so a clean gate already means none, and an
   * override label makes the verdict wait. With one, null (wait) when the read fails or may
   * have been cut short: `recent` returns the newest PRs' findings, so a PR missing from a full
   * page (or a read at the findings cap) may have findings it didn't return.
   */
  private async openFindings(
    projectId: string,
    repo: string,
    pr: PullRequest,
  ): Promise<number | null> {
    if (!this.findings) return 0;
    try {
      const recent = await this.findings.recent(projectId, {
        maxPulls: FINDING_PULLS,
        maxFindings: FINDING_LIMIT,
      });
      const pulls = new Set(recent.map((f) => `${f.repo}#${f.pullNumber}`));
      const listed = pulls.has(`${repo}#${pr.number}`);
      if (recent.length >= FINDING_LIMIT || (!listed && pulls.size >= FINDING_PULLS)) return null;
      return openFindingsOn(recent, { repo, number: pr.number, headSha: pr.headSha });
    } catch (err) {
      log("WARNING", "review findings read failed", { pr: pr.number, error: errorText(err) });
      return null;
    }
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
    /** The launch's epic key when merging into its epic branch (AI-124); null: the default branch. */
    epicKey: string | null = null,
    /** The mode that allowed a merge into the default branch, for the ticket's record. */
    mode: Project["mergeMode"] = null,
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
    let sha: string | null;
    try {
      sha = await this.host.mergePullRequest(repo, pr.number, pr.headSha);
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
    if (epicKey) {
      log("INFO", "merged into the epic branch", { ...base, branch: pr.baseRef, epicKey });
      await this.recordEpicMerge(run, ticket, pr, sha);
      return { result: "merged", ...base };
    }
    log("INFO", "auto-merged", { ...base, mode });
    // ADR-0124 "Record": each merge without Andy says which mode allowed it.
    await this.tracker.addComment(
      ticket.projectId,
      ticket.id,
      `The gate merged PR #${pr.number} under merge mode ${mode ?? "unknown"}: every check and both reviews passed and the merge verdict allowed it.`,
      "system",
    );
    return { result: "merged", ...base };
  }

  /**
   * After a merge into the epic branch: records it on the run, for the morning PR, and moves the
   * story to Done (ADR-0107), so its dependants build on the branch and the launch can finish.
   * Both steps are idempotent; the PR's close webhook runs them again, so a failure here is
   * flagged on the story and retried there instead of lost. Never throws.
   */
  private async recordEpicMerge(
    run: Run,
    ticket: Ticket,
    pr: PullRequest,
    sha: string | null,
  ): Promise<boolean> {
    try {
      const current = (await this.runs.get(run.id)) ?? run;
      if (!current.epicMerge) {
        await this.runs.update(run.id, { epicMerge: { at: this.now().toISOString(), sha } }, [
          "succeeded",
        ]);
      }
      await this.tickets.followPullRequest(
        ticket.projectId,
        ticket.id,
        "done",
        `PR #${pr.number} merged into ${pr.baseRef} (night launch): ${pr.url}`,
      );
      return true;
    } catch (err) {
      const error = errorText(err);
      log("ERROR", "epic merge bookkeeping failed", { pr: pr.number, runId: run.id, error });
      try {
        await this.tickets.flag(ticket.projectId, ticket.id, "system");
        await this.tracker.addComment(
          ticket.projectId,
          ticket.id,
          `PR #${pr.number} merged into ${pr.baseRef}, but recording it failed (retried when its close arrives): ${error}`,
          "system",
        );
      } catch (flagErr) {
        log("ERROR", "flag after epic merge failed", { runId: run.id, error: errorText(flagErr) });
      }
      return false;
    }
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
    // Recovers a night merge whose bookkeeping failed after the merge call (AI-124).
    if (
      pr.state === "merged" &&
      this.epicMerges &&
      intoEpicBranch(pr) &&
      run.baseBranch === pr.baseRef
    ) {
      await this.recordEpicMerge(run, ticket, pr, null);
    }

    let decision: GateDecision | null = null;
    try {
      decision = (await this.assess(repo, pr, run, ticket)).decision;
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
              outsideDocs: decision.outsideDocs,
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

  private async assess(
    repo: string,
    pr: PullRequest,
    run: Run,
    ticket: Ticket,
  ): Promise<{ decision: GateDecision; files: Listing<ChangedFile> }> {
    const rules = await this.rulesBranch(repo, pr);
    const [files, codeowners, required, checks, active] = await Promise.all([
      this.host.listChangedFiles(repo, pr.number),
      // The base branch's file: a PR can't unprotect a path by editing CODEOWNERS.
      Promise.all(CODEOWNERS_PATHS.map((p) => this.host.readFile(repo, p, rules))),
      this.host.listRequiredChecks(repo, rules),
      this.host.listHeadChecks(repo, pr.headSha),
      this.runs.listActive(run.projectId),
    ]);
    const decision = decideGate({
      verification: run.verification,
      draft: pr.draft,
      intoDefaultBranch: pr.intoDefaultBranch,
      files,
      codeowners: codeowners.flatMap((text) => (text === null ? [] : codeownersGlobs(text))),
      required,
      checks,
      // AI-72 (ADR-0083): never merge a head a queued or running sync run is about to replace.
      syncPending: syncPendingFor(run, active, this.now()),
      ticketType: ticket.type,
    });
    return { decision, files };
  }

  /**
   * The branch whose CODEOWNERS and required checks apply: the PR's base, except an epic branch
   * (no rules of its own), which takes the default branch's, so a night merge needs what a merge
   * into the default branch needs (AI-124).
   */
  private async rulesBranch(repo: string, pr: PullRequest): Promise<string> {
    if (!intoEpicBranch(pr)) return pr.baseRef;
    const defaultBranch = (await this.host.getRepo(repo))?.defaultBranch;
    if (!defaultBranch) throw new Error(`couldn't read the default branch of ${repo}`);
    return defaultBranch;
  }

  private async flagOnce(run: Run, ticket: Ticket, decision: GateDecision): Promise<void> {
    if (run.gateFlaggedAt) return;
    await this.runs.update(run.id, { gateFlaggedAt: this.now().toISOString() }, ["succeeded"]);
    await this.tickets.flag(ticket.projectId, ticket.id, "system");
    // A spike's protected path is also outside docs/: list it once.
    const files = [...new Set([...decision.protectedFiles, ...decision.outsideDocs])]
      .slice(0, MAX_LISTED_FILES)
      .join(", ");
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
