import {
  EPIC_BRANCH_PATTERN,
  NIGHT_LIMITS,
  nightLaunchIsActive,
  type CodeHost,
  type NightLaunch,
  type NightLaunchStore,
  type PullRequest,
  type Run,
  type RunStore,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import type { GateDecision } from "./gate";
import { NIGHT_END_TEXT } from "./night-budget";
import type { TicketService } from "./tickets";

/**
 * Night merges and the morning PR (AI-124, ADR-0049 "Epic branch" and "Morning review",
 * ADR-0107). A story PR into its running launch's `epic/<KEY>` branch merges there when the gate
 * passes on every rule except `not_default_branch`, whatever the project's `autoMerge` policy,
 * because nothing reaches the default branch. When the launch ends, one PR `epic/<KEY>` → the
 * default branch opens for Andy, listing each story's commit range. That PR's head is no agent
 * branch, so the gate never touches it: it never auto-merges.
 */

/**
 * The bound on merges into one launch's epic branch (ADR-0028): once per story, checked against
 * the merges recorded on its runs, and a launch has at most `NIGHT_LIMITS.maxStories` stories.
 */
export const MAX_EPIC_MERGES_PER_LAUNCH = NIGHT_LIMITS.maxStories;

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "night-merge", ...fields }));
}

/** The PR targets an `epic/<KEY>` branch, never the default branch. */
export function intoEpicBranch(pr: Pick<PullRequest, "intoDefaultBranch" | "baseRef">): boolean {
  return !pr.intoDefaultBranch && EPIC_BRANCH_PATTERN.test(pr.baseRef);
}

/**
 * Whether the gate passes a PR into an epic branch: `not_default_branch` is its only reason. Every
 * other veto (checks, reviews, protected paths, draft, sync, missing output) still holds.
 */
export function passesIntoEpic(decision: Pick<GateDecision, "reasons">): boolean {
  return decision.reasons.length === 1 && decision.reasons[0] === "not_default_branch";
}

/** Story stages a merge into the epic branch may start from: the PR is open, the story isn't Done. */
const MERGEABLE_STAGES: readonly Ticket["stage"][] = ["in_progress", "ready_for_review"];

/**
 * Decides which story PRs may merge into an epic branch. Facts come from the stored launch and
 * the run, never from PR text: the PR's base must be the active launch's recorded epic branch
 * and the run's own base branch, and the ticket one of the launch's stories.
 */
export class EpicMerges {
  constructor(
    private readonly launches: Pick<NightLaunchStore, "findActive">,
    private readonly runs: Pick<RunStore, "listForTicket">,
  ) {}

  /** The active launch the PR may merge into, or null (the PR then stays open). */
  async target(
    pr: Pick<PullRequest, "number" | "intoDefaultBranch" | "baseRef">,
    run: Pick<Run, "projectId" | "baseBranch">,
    ticket: Pick<Ticket, "id" | "key" | "stage">,
  ): Promise<NightLaunch | null> {
    if (!intoEpicBranch(pr) || run.baseBranch !== pr.baseRef) return null;
    const launch = await this.launches.findActive(run.projectId);
    if (
      !launch ||
      !nightLaunchIsActive(launch) ||
      launch.epicBranch?.name !== pr.baseRef ||
      !launch.storyKeys.includes(ticket.key) ||
      !MERGEABLE_STAGES.includes(ticket.stage)
    ) {
      return null;
    }
    // Once per story, from the merge claims, not the stage or the merge record: the claim is
    // written before the host is called, so a story whose merge record or move to Done failed
    // after its merge never merges again. With at most `maxStories` stories, that bounds the launch.
    const runs = await this.runs.listForTicket(run.projectId, ticket.id);
    if (epicMergeAttempted(launch, runs)) {
      log("WARNING", "story already merged into the epic branch", {
        launchId: launch.id,
        pr: pr.number,
        ticket: ticket.key,
      });
      return null;
    }
    return launch;
  }
}

/**
 * Whether any of these runs (one story's) claimed a merge into the launch's epic branch since it
 * started: `mergeAttemptedSha` is set before the merge call, whatever the call did afterwards. A
 * merge the host refused also counts; it was flagged, and Andy decides.
 */
export function epicMergeAttempted(
  launch: Pick<NightLaunch, "startedAt" | "epicBranch">,
  runs: readonly Pick<
    Run,
    "step" | "baseBranch" | "createdAt" | "mergeAttemptedSha" | "epicMerge"
  >[],
): boolean {
  const since = launch.startedAt ? Date.parse(launch.startedAt) : -Infinity;
  return runs.some(
    (r) =>
      r.step === "build" &&
      r.baseBranch === launch.epicBranch?.name &&
      (r.mergeAttemptedSha !== null || r.epicMerge !== null) &&
      // A run with no creation time counts, so a missing field can only refuse a merge.
      !(r.createdAt && Date.parse(r.createdAt) < since),
  );
}

/** One story merged into the epic branch during a launch. */
export interface MergedStory {
  key: string;
  pullRequest: string;
  at: string;
  /** The squash commit; null when the code host didn't report it. */
  sha: string | null;
}

/**
 * The launch's merged stories, oldest merge first: build runs that targeted its epic branch and
 * were merged into it since it started; the newest merge per story.
 */
export function mergedStories(
  launch: Pick<NightLaunch, "startedAt" | "epicBranch">,
  stories: readonly Pick<Ticket, "id" | "key">[],
  runs: readonly Pick<Run, "ticketId" | "step" | "baseBranch" | "epicMerge" | "links">[],
): MergedStory[] {
  const since = launch.startedAt ? Date.parse(launch.startedAt) : -Infinity;
  const out: MergedStory[] = [];
  for (const story of stories) {
    const latest = runs
      .filter(
        (r) =>
          r.ticketId === story.id &&
          r.step === "build" &&
          r.epicMerge !== null &&
          r.baseBranch === launch.epicBranch?.name &&
          r.links.pullRequest &&
          Date.parse(r.epicMerge.at) >= since,
      )
      .sort((a, b) => b.epicMerge!.at.localeCompare(a.epicMerge!.at))[0];
    if (latest) {
      const { at, sha } = latest.epicMerge!;
      out.push({ key: story.key, pullRequest: latest.links.pullRequest!, at, sha });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

const short = (sha: string) => sha.slice(0, 12);

/**
 * The morning PR's description: the epic's link first (it links the PR to the epic, AI-14), then
 * each story with its commit range (previous tip..its squash commit) and PR. Only keys, links and
 * shas: no ticket or PR text.
 */
export function morningPrBody(
  epicLink: string,
  launch: Pick<NightLaunch, "epicKey" | "endReason" | "epicBranch">,
  merged: readonly MergedStory[],
): string {
  const ended = launch.endReason ? NIGHT_END_TEXT[launch.endReason] : "it ended";
  const lines = [
    epicLink,
    "",
    `Overnight launch of ${launch.epicKey}; it ended because ${ended}. Each story merged into \`${launch.epicBranch?.name ?? ""}\` as one squashed commit, after its own checks and both review agents passed. Review story by story.`,
    "",
    "This PR never merges on its own: Andy merges it.",
    "",
    "| Story | Commits | PR |",
    "| ----- | ------- | -- |",
  ];
  let previous = launch.epicBranch?.sha ?? null;
  for (const story of merged) {
    const range =
      story.sha && previous ? `\`${short(previous)}..${short(story.sha)}\`` : "not reported";
    lines.push(`| ${story.key} | ${range} | ${story.pullRequest} |`);
    previous = story.sha;
  }
  return lines.join("\n");
}

/**
 * `<epic key>: <epic title> (overnight)`, capped. The title is Andy's ticket text; `@` is dropped
 * so it can't notify anyone, and line breaks are flattened.
 */
export function morningPrTitle(epicKey: string, epicTitle: string): string {
  const title = epicTitle.replace(/@/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return `${epicKey}: ${title} (overnight)`;
}

/** The code host calls the morning step needs: the App token, `epic/<KEY>` branches only. */
export type MorningPrHost = Pick<
  CodeHost,
  "getRepo" | "branchSha" | "openEpicPullRequest" | "deleteEpicBranch"
>;

export type MorningResult =
  | { result: "opened"; number: number; url: string; stories: number }
  /** An open PR from the epic branch is already there (another end call, or an earlier night). */
  | { result: "exists"; stories: number }
  /** No story merged and the branch held nothing new: deleted (or already gone). */
  | { result: "deleted" }
  /** No story merged this launch, but the branch holds an earlier launch's work: left alone. */
  | { result: "kept" }
  | { result: "skipped"; reason: "not_ended" | "no_epic_branch" | "no_repo" }
  | { result: "failed"; error: string };

/** Called once a launch has ended; `NightLaunches.end` and `BuildDispatcher` call it. */
export interface MorningPrOpener {
  open(launch: NightLaunch): Promise<MorningResult>;
}

/**
 * Opens the morning PR when a launch ends, or deletes an epic branch nothing merged into. Safe to
 * call twice: the code host refuses a second open PR for the same head and base.
 */
export class MorningPullRequests implements MorningPrOpener {
  constructor(
    private readonly tracker: Pick<
      WorkTracker,
      "getProject" | "getTicket" | "listTickets" | "addComment"
    >,
    private readonly runs: Pick<RunStore, "listForTicket">,
    private readonly host: MorningPrHost,
    /** The web app's origin, for the epic's link. */
    private readonly appUrl: string,
    /** Flags a ticket Needs-you (`TicketService.flag`). */
    private readonly tickets: Pick<TicketService, "flag">,
  ) {}

  /**
   * Never throws. A failure is logged and flags the epic Needs-you with what to do, since nothing
   * calls this again once the launch has ended; the branch and the stories stay as they are.
   */
  async open(launch: NightLaunch): Promise<MorningResult> {
    try {
      return await this.settle(launch);
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
      log("ERROR", "morning PR failed", { launchId: launch.id, error });
      await this.flagEpic(launch, error);
      return { result: "failed", error };
    }
  }

  private async flagEpic(launch: NightLaunch, error: string): Promise<void> {
    const branch = launch.epicBranch?.name ?? `epic/${launch.epicKey}`;
    try {
      await this.tickets.flag(launch.projectId, launch.epicId, "system");
      await this.tracker.addComment(
        launch.projectId,
        launch.epicId,
        `The night launch ended, but its morning PR from ${branch} couldn't be opened: ${error}. Open a PR from ${branch} into the default branch by hand.`,
        "system",
      );
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      log("ERROR", "flagging the epic after a failed morning PR failed", {
        launchId: launch.id,
        error: why.slice(0, 2000),
      });
    }
  }

  private async settle(launch: NightLaunch): Promise<MorningResult> {
    if (launch.status !== "ended") return { result: "skipped", reason: "not_ended" };
    const branch = launch.epicBranch;
    if (!branch) return { result: "skipped", reason: "no_epic_branch" };
    const project = await this.tracker.getProject(launch.projectId);
    const fullName = project?.repos[0];
    const repo = fullName ? await this.host.getRepo(fullName) : null;
    if (!project || !fullName || !repo) return { result: "skipped", reason: "no_repo" };

    const keys = new Set(launch.storyKeys);
    const stories = (await this.tracker.listTickets(launch.projectId)).filter((t) =>
      keys.has(t.key),
    );
    // One run list per story, at most `NIGHT_LIMITS.maxStories` (ADR-0028).
    const runs = (
      await Promise.all(stories.map((t) => this.runs.listForTicket(launch.projectId, t.id)))
    ).flat();
    const merged = mergedStories(launch, stories, runs);
    const fields = { launchId: launch.id, branch: branch.name };

    if (merged.length === 0) {
      const tip = await this.host.branchSha(fullName, branch.name);
      // A reused branch (ADR-0049: an epic may span nights) can hold an earlier night's work.
      if (tip !== null && tip !== branch.sha) {
        log("WARNING", "no story merged; epic branch kept", { ...fields, tip });
        return { result: "kept" };
      }
      if (tip !== null) await this.host.deleteEpicBranch(fullName, branch.name);
      log("INFO", "no story merged; epic branch deleted", fields);
      return { result: "deleted" };
    }

    const epic = await this.tracker.getTicket(launch.projectId, launch.epicId);
    const epicLink = `${this.appUrl}/p/${encodeURIComponent(launch.projectId)}/t/${launch.epicKey}`;
    const opened = await this.host.openEpicPullRequest(fullName, {
      head: branch.name,
      base: repo.defaultBranch,
      title: morningPrTitle(launch.epicKey, epic?.title ?? "epic"),
      body: morningPrBody(epicLink, launch, merged),
    });
    if (opened === "exists") {
      log("INFO", "morning PR already open", fields);
      return { result: "exists", stories: merged.length };
    }
    log("INFO", "morning PR opened", { ...fields, pr: opened.number, stories: merged.length });
    return { result: "opened", ...opened, stories: merged.length };
  }
}
