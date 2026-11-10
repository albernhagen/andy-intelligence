import {
  NewProject,
  ProjectSettings,
  RepoName,
  type CodeHost,
  type Project,
  type WorkTracker,
} from "@andy/contracts";
import { notFound } from "@andy/contracts";
import { DomainError } from "./tickets";

function log(severity: "INFO" | "WARNING", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "projects", ...fields }));
}

/**
 * Project registration rules (M1.5: GitHub App + project registration). A repo belongs to at
 * most one project, so each webhook delivery maps to exactly one project. With a code host
 * configured, every repo must have our App installed; repos are stored with the host's spelling.
 */
export class ProjectService {
  constructor(
    private readonly tracker: WorkTracker,
    /** Null when the GitHub App isn't configured (local dev): repos are only format-checked. */
    private readonly codeHost: CodeHost | null,
    /**
     * The build and refine dispatchers (ADR-0063, ADR-0054): turning auto-build or auto-refine
     * on starts any waiting run.
     */
    private readonly dispatchNext: ((projectId: string) => Promise<unknown>) | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Changes a project's switches. `buildEnabled` records who (`by`, the signed-in email) and
   * when; turning it off turns `autoBuild` off too, and `autoBuild` can't be on without it
   * (ADR-0063: no build before the live sandbox proof).
   */
  async update(projectId: string, settings: ProjectSettings, by: string): Promise<Project> {
    const patch = ProjectSettings.parse(settings);
    const current = await this.tracker.getProject(projectId);
    if (!current) throw notFound("project", projectId);
    const buildEnabled = patch.buildEnabled ?? current.buildEnabled;
    if (patch.autoBuild === true && !buildEnabled) {
      throw new DomainError("not_buildable", `builds are off for project ${current.key}`, [
        "turn builds on first, after the live sandbox proof (runbook agent-runs.md §9)",
      ]);
    }
    const project = await this.tracker.updateProject(projectId, {
      ...patch,
      ...(patch.buildEnabled === undefined
        ? {}
        : {
            buildEnabledBy: by,
            buildEnabledAt: this.now().toISOString(),
            ...(patch.buildEnabled ? {} : { autoBuild: false }),
          }),
    });
    if (patch.buildEnabled !== undefined) {
      log("INFO", "project builds switched", { projectId, buildEnabled: patch.buildEnabled, by });
    }
    // With builds on, queued sync runs (AI-72) may start too, e.g. once pause is lifted.
    if (project.autoRefine || project.autoBuild || project.buildEnabled) {
      await this.dispatchNext?.(projectId);
    }
    return project;
  }

  async register(input: NewProject): Promise<Project> {
    const parsed = NewProject.parse(input);
    const owners = new Map<string, string>();
    for (const p of await this.tracker.listProjects()) {
      for (const r of p.repos) owners.set(r.toLowerCase(), p.key);
    }

    const repos: string[] = [];
    for (const name of parsed.repos) {
      if (!RepoName.safeParse(name).success) {
        throw new DomainError("invalid_repo", `not an owner/name repo: ${name}`);
      }
      const owner = owners.get(name.toLowerCase());
      if (owner) throw new DomainError("repo_taken", `${name} already belongs to project ${owner}`);
      if (repos.some((r) => r.toLowerCase() === name.toLowerCase())) continue;
      repos.push(await this.canonical(name));
    }
    return this.tracker.createProject({ ...parsed, repos });
  }

  private async canonical(name: string): Promise<string> {
    if (!this.codeHost) return name;
    const repo = await this.codeHost.getRepo(name);
    if (!repo) {
      throw new DomainError(
        "invalid_repo",
        `${name} not found, GitHub isn't connected, or the GitHub App isn't installed on it (Settings → GitHub)`,
      );
    }
    return repo.fullName;
  }
}

/** The project that owns `repo` (case-insensitive), or null. */
export function projectForRepo(projects: Project[], repo: string): Project | null {
  const lower = repo.toLowerCase();
  return projects.find((p) => p.repos.some((r) => r.toLowerCase() === lower)) ?? null;
}
