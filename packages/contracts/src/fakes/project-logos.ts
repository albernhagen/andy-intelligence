import { ProjectLogo } from "../entities/project-logo";
import type { ProjectLogoStore } from "../ports/project-logos";

/** In-memory ProjectLogoStore (AI-393): one logo per project id. */
export class InMemoryProjectLogoStore implements ProjectLogoStore {
  private readonly logos = new Map<string, ProjectLogo>();

  async get(projectId: string): Promise<ProjectLogo | null> {
    const logo = this.logos.get(projectId);
    return logo ? structuredClone(logo) : null;
  }

  async put(logo: ProjectLogo): Promise<ProjectLogo> {
    const parsed = ProjectLogo.parse(logo);
    this.logos.set(parsed.projectId, parsed);
    return structuredClone(parsed);
  }

  async remove(projectId: string): Promise<void> {
    this.logos.delete(projectId);
  }
}
