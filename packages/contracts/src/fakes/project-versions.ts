import type { ProjectVersions } from "../ports/project-versions";

export class InMemoryProjectVersions implements ProjectVersions {
  private readonly versions = new Map<string, number>();

  async get(projectId: string): Promise<number> {
    return this.versions.get(projectId) ?? 0;
  }

  async bump(projectId: string): Promise<void> {
    this.versions.set(projectId, (this.versions.get(projectId) ?? 0) + 1);
  }
}
