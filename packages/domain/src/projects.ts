import {
  NewProject,
  RepoName,
  type CodeHost,
  type Project,
  type WorkTracker,
} from "@andy/contracts";
import { DomainError } from "./tickets";

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
  ) {}

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
        `${name} not found or the GitHub App isn't installed on it (docs/runbooks/github-app.md)`,
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
