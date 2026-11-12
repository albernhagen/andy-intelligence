import {
  EPIC_BRANCH_PATTERN,
  epicBranchName,
  nightLaunchIsActive,
  notFound,
  type BaseBranch,
  type CodeHost,
  type NightLaunch,
  type NightLaunchStore,
  type WorkTracker,
} from "@andy/contracts";
import { DomainError } from "./errors";

/**
 * Epic branches for night launches (AI-122, ADR-0049). At launch the control plane creates
 * `epic/<KEY>` from the default branch's tip; while the launch is active, builds of its stories
 * branch from it and open their PRs against it. Everything else builds on the default branch.
 */

/** The code host writes an epic branch needs: the App token, `epic/<KEY>` refs only. */
export interface EpicBranchHost extends Pick<CodeHost, "getRepo" | "headContains"> {
  /** The branch's tip commit; null when it doesn't exist. */
  branchSha(fullName: string, branch: string): Promise<string | null>;
  /** Creates the branch at `sha`; "exists" when a branch of that name is already there. */
  createBranch(fullName: string, branch: BaseBranch, sha: string): Promise<"created" | "exists">;
}

export type EpicBranch = NonNullable<NightLaunch["epicBranch"]>;

/** Opens a launch's epic branch; `NightLaunches.start` calls it once, before storing the launch. */
export interface EpicBranchOpener {
  open(projectId: string, epic: { id: string; key: string }): Promise<EpicBranch>;
}

function log(severity: "INFO" | "WARNING", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "night-branch", ...fields }));
}

export class EpicBranches implements EpicBranchOpener {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly host: EpicBranchHost,
    private readonly launches: Pick<NightLaunchStore, "listForProject">,
  ) {}

  /**
   * Creates `epic/<KEY>` at the default branch's tip, in the project's first repo (as builds
   * use); one call per launch, so one branch. An epic launched again on a later night reuses its
   * branch (ADR-0049: an epic may span nights) when the epic's previous launch, now ended,
   * recorded it and the branch still contains that launch's starting commit; the start is kept.
   * Any other existing branch came from elsewhere and is refused (`not_buildable`).
   */
  async open(projectId: string, epic: { id: string; key: string }): Promise<EpicBranch> {
    const epicKey = epic.key;
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const fullName = project.repos[0];
    if (!fullName) {
      throw new DomainError(
        "not_buildable",
        `${project.key} has no repo to make the epic branch in`,
      );
    }
    const repo = await this.host.getRepo(fullName);
    if (!repo) throw new DomainError("invalid_repo", `the App can't read ${fullName}`);
    const name = epicBranchName(epicKey);
    const exists = (): never => {
      log("WARNING", "epic branch exists", { projectId, branch: name });
      throw new DomainError(
        "not_buildable",
        `${name} already exists in ${fullName} and isn't the epic's previous launch's`,
        [`Delete ${name} (after checking nothing on it is needed), then launch again.`],
      );
    };
    const tip = await this.host.branchSha(fullName, name);
    if (tip !== null) return this.reuse(projectId, fullName, epic.id, name, tip, exists);
    const sha = await this.host.branchSha(fullName, repo.defaultBranch);
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
      throw new DomainError(
        "not_buildable",
        `couldn't read the tip of ${repo.defaultBranch} in ${fullName}`,
      );
    }
    // A branch made between the read above and this write is refused here too.
    if ((await this.host.createBranch(fullName, name, sha)) === "exists") exists();
    log("INFO", "epic branch created", { projectId, branch: name, sha });
    return { name, sha };
  }

  private async reuse(
    projectId: string,
    fullName: string,
    epicId: string,
    name: BaseBranch,
    tip: string,
    exists: () => never,
  ): Promise<EpicBranch> {
    // Newest first: the epic's previous launch is the first one for it.
    const previous = (await this.launches.listForProject(projectId)).find(
      (l) => l.epicId === epicId,
    );
    const recorded = previous?.status === "ended" ? previous.epicBranch : null;
    if (!recorded || recorded.name !== name) return exists();
    // Rewritten history, or a branch remade at another commit, doesn't descend from the start.
    if ((await this.host.headContains(fullName, tip, recorded.sha)) !== true) return exists();
    log("INFO", "epic branch reused", { projectId, branch: name, from: previous!.id, tip });
    return recorded;
  }
}

/**
 * The base branch for a build of `ticketKey`: the epic branch of the project's active launch when
 * it covers the story, else null (the default branch). Only a launch's stored, checked
 * `epicBranch` is used, so the value never comes from ticket or PR text.
 */
export async function buildBaseBranch(
  launches: Pick<NightLaunchStore, "findActive">,
  projectId: string,
  ticketKey: string,
): Promise<BaseBranch | null> {
  const launch = await launches.findActive(projectId);
  if (!launch || !nightLaunchIsActive(launch) || !launch.storyKeys.includes(ticketKey)) {
    return null;
  }
  const name = launch.epicBranch?.name ?? null;
  return name && EPIC_BRANCH_PATTERN.test(name) ? name : null;
}
