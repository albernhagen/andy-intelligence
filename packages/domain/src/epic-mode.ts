import {
  epicBranchName,
  nightLaunchIsActive,
  type BaseBranch,
  type CodeHost,
  type NightLaunchStore,
  type PullRequest,
  type Run,
  type RunStore,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { DomainError } from "./errors";
import { ticketMergeMode } from "./merge-facts";
import {
  epicMergeAttempted,
  mergedStories,
  type EpicTarget,
  type MergedStory,
} from "./night-merge";
import { cascadesFrom } from "./overrides";

/**
 * The `epic` merge mode in the daytime (AI-216, ADR-0124): a child ticket of an epic builds on
 * `epic/<KEY>`, its clean PR merges there through the night-merge path (`EpicMerges`, the gate's
 * epic-branch merge and its bookkeeping, AI-124), and when the epic's last open child ticket is
 * Done one PR `epic/<KEY>` → the default branch opens for Andy. That PR's head is no agent branch,
 * so the gate never merges it. A ticket with no epic builds on the default branch and its PR waits
 * for Andy (`mode_epic`), as in `manual`. Facts come from stored tickets and runs, never PR text.
 */

/**
 * The bound on merges into one epic branch (ADR-0028): once per child ticket (the run's merge
 * claim), and an epic with more open or Done child tickets than this merges none into its branch.
 */
export const MAX_EPIC_CHILDREN = 50;

/** Child stages a merge into the epic branch may start from: the PR is open, the ticket not Done. */
const MERGEABLE_STAGES: readonly Ticket["stage"][] = ["in_progress", "ready_for_review"];

/** The code host calls epic mode needs: the App token, `epic/<KEY>` branches only. */
export type EpicModeHost = Pick<
  CodeHost,
  "getRepo" | "branchSha" | "createBranch" | "openEpicPullRequest"
>;

export type EpicPrResult =
  | { result: "opened"; number: number; url: string; children: number }
  | { result: "exists"; children: number }
  | {
      result: "skipped";
      reason: "not_epic_mode" | "night_launch" | "children_open" | "nothing_merged" | "no_repo";
    }
  | { result: "failed"; error: string };

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "epic-mode", ...fields }));
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 2000);

export class EpicMode {
  constructor(
    private readonly tracker: Pick<
      WorkTracker,
      "getProject" | "getTicket" | "listTickets" | "addComment"
    >,
    private readonly runs: Pick<RunStore, "listForTicket">,
    /** Null until a code host is connected: builds then use the default branch. */
    private readonly host: EpicModeHost | null,
    /** The web app's origin, for the epic's link in the epic PR. */
    private readonly appUrl: string,
    /** Night launches: an epic under an active launch gets its morning PR instead. */
    private readonly launches: Pick<NightLaunchStore, "findActive"> | null = null,
  ) {}

  /** The epic the ticket's work merges into: its parent epic when its mode is `epic`; else null. */
  async epicFor(projectId: string, ticket: Ticket): Promise<Ticket | null> {
    if (!ticket.parentId || ticket.type === "epic") return null;
    const project = await this.tracker.getProject(projectId);
    if (!project) return null;
    const epic = cascadesFrom(await this.tracker.getTicket(projectId, ticket.parentId));
    if (!epic) return null;
    return (await ticketMergeMode(this.tracker, project, ticket)) === "epic" ? epic : null;
  }

  /**
   * A build's base branch in epic mode: `epic/<KEY>` of the ticket's epic, made from the default
   * branch's tip when it doesn't exist yet. An existing branch is reused: in epic mode it collects
   * the epic's child tickets until Andy merges its PR. Null: not epic mode, no epic, no host, or
   * an epic over `MAX_EPIC_CHILDREN` (its child tickets then build on the default branch and their
   * PRs wait for Andy with `mode_epic`, instead of opening PRs into a branch nothing merges into).
   */
  async baseBranch(projectId: string, ticket: Ticket): Promise<BaseBranch | null> {
    if (!this.host) return null;
    const epic = await this.epicFor(projectId, ticket);
    if (!epic) return null;
    if ((await this.children(projectId, epic.id)).length > MAX_EPIC_CHILDREN) {
      log("WARNING", "epic over the child ticket bound; building on the default branch", {
        projectId,
        ticket: ticket.key,
        epic: epic.key,
      });
      return null;
    }
    const project = await this.tracker.getProject(projectId);
    const fullName = project?.repos[0];
    const repo = fullName ? await this.host.getRepo(fullName) : null;
    if (!fullName || !repo) return null;
    const name = epicBranchName(epic.key);
    if ((await this.host.branchSha(fullName, name)) !== null) return name;
    const tip = await this.host.branchSha(fullName, repo.defaultBranch);
    if (!tip || !/^[0-9a-f]{40}$/.test(tip)) {
      throw new DomainError(
        "not_buildable",
        `couldn't read the tip of ${repo.defaultBranch} in ${fullName} to make ${name}`,
      );
    }
    const made = await this.host.createBranch(fullName, name, tip);
    log("INFO", "epic branch for epic mode", { projectId, branch: name, sha: tip, made });
    return name;
  }

  /**
   * The epic a child ticket's PR may merge into now (the PR's base is its epic's branch), or
   * null: not epic mode, another branch, a stage past review, over the bound, or already merged
   * once. The caller has checked that the PR's base is also its run's base.
   */
  async target(
    pr: Pick<PullRequest, "number" | "baseRef">,
    run: Pick<Run, "projectId">,
    ticket: Ticket,
  ): Promise<EpicTarget | null> {
    const epic = await this.epicFor(run.projectId, ticket);
    if (!epic || epicBranchName(epic.key) !== pr.baseRef) return null;
    if (!MERGEABLE_STAGES.includes(ticket.stage)) return null;
    const fields = { pr: pr.number, ticket: ticket.key, epic: epic.key };
    if ((await this.children(run.projectId, epic.id)).length > MAX_EPIC_CHILDREN) {
      log("WARNING", "epic over the child ticket bound; nothing merges into its branch", fields);
      return null;
    }
    const runs = await this.runs.listForTicket(run.projectId, ticket.id);
    const branch = { name: pr.baseRef, sha: "" };
    if (epicMergeAttempted({ startedAt: null, epicBranch: branch }, runs)) {
      log("WARNING", "child ticket already merged into the epic branch", fields);
      return null;
    }
    return { epicKey: epic.key, epicId: epic.id, launch: null };
  }

  /**
   * After a child ticket's merge into its epic branch: opens the epic PR for Andy when the epic's
   * last open child ticket is Done. Two last merges racing can't both miss it: each caller moves
   * its own ticket to Done before it reads the child tickets, so whichever reads last sees both
   * Done (a second open is refused by the host). The close webhook calls this again. Safe to call again: the host refuses a second open PR for the
   * same head and base. Never throws; a failure is a comment on the epic.
   */
  async openWhenDone(projectId: string, child: Ticket): Promise<EpicPrResult> {
    const epic = await this.epicFor(projectId, child).catch(() => null);
    if (!epic) return { result: "skipped", reason: "not_epic_mode" };
    try {
      return await this.open(projectId, epic);
    } catch (err) {
      const error = errorText(err);
      log("ERROR", "epic PR failed", { epic: epic.key, error });
      try {
        await this.tracker.addComment(
          projectId,
          epic.id,
          `Every child ticket is Done, but the PR from ${epicBranchName(epic.key)} into the default branch couldn't be opened: ${error}. Open it by hand.`,
          "system",
        );
      } catch (commentErr) {
        log("ERROR", "comment after a failed epic PR failed", { error: errorText(commentErr) });
      }
      return { result: "failed", error };
    }
  }

  private async open(projectId: string, epic: Ticket): Promise<EpicPrResult> {
    const launch = this.launches ? await this.launches.findActive(projectId) : null;
    if (launch && nightLaunchIsActive(launch) && launch.epicId === epic.id) {
      return { result: "skipped", reason: "night_launch" };
    }
    const children = await this.children(projectId, epic.id);
    if (children.some((t) => t.stage !== "done")) {
      return { result: "skipped", reason: "children_open" };
    }
    const name = epicBranchName(epic.key);
    // At most `MAX_EPIC_CHILDREN` run lists: `target` merges nothing for a larger epic.
    const listed = children.slice(0, MAX_EPIC_CHILDREN);
    const runs = (
      await Promise.all(listed.map((t) => this.runs.listForTicket(projectId, t.id)))
    ).flat();
    const merged = mergedStories({ startedAt: null, epicBranch: { name, sha: "" } }, listed, runs);
    if (merged.length === 0) return { result: "skipped", reason: "nothing_merged" };
    const project = await this.tracker.getProject(projectId);
    const fullName = project?.repos[0];
    const repo = fullName && this.host ? await this.host.getRepo(fullName) : null;
    if (!fullName || !repo || !this.host) return { result: "skipped", reason: "no_repo" };
    const epicLink = `${this.appUrl}/p/${encodeURIComponent(projectId)}/t/${epic.key}`;
    const opened = await this.host.openEpicPullRequest(fullName, {
      head: name,
      base: repo.defaultBranch,
      title: epicPrTitle(epic.key, epic.title),
      body: epicPrBody(epicLink, name, merged),
    });
    if (opened === "exists") return { result: "exists", children: merged.length };
    log("INFO", "epic PR opened", { epic: epic.key, pr: opened.number, children: merged.length });
    return { result: "opened", ...opened, children: merged.length };
  }

  /** The epic's open and Done child tickets (not cancelled or archived). */
  private async children(projectId: string, epicId: string): Promise<Ticket[]> {
    return (await this.tracker.listTickets(projectId)).filter(
      (t) => t.parentId === epicId && !t.archived && t.stage !== "cancelled",
    );
  }
}

/** `<epic key>: <epic title>`, capped; `@` dropped so it can't notify, line breaks flattened. */
export function epicPrTitle(epicKey: string, epicTitle: string): string {
  const title = epicTitle.replace(/@/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return `${epicKey}: ${title}`;
}

/**
 * The epic PR's description: the epic's link first (it links the PR to the epic, AI-14), then
 * each child ticket with its PR. Only keys and links: no ticket or PR text.
 */
export function epicPrBody(epicLink: string, branch: string, merged: readonly MergedStory[]) {
  return [
    epicLink,
    "",
    `Epic merge mode: each child ticket merged into \`${branch}\` as one squashed commit, after its own checks and both review agents passed. Review child ticket by child ticket.`,
    "",
    "This PR never merges on its own: Andy merges it.",
    "",
    "| Child ticket | PR |",
    "| ------------ | -- |",
    ...merged.map((m) => `| ${m.key} | ${m.pullRequest} |`),
  ].join("\n");
}
