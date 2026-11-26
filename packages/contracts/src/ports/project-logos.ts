import type { ProjectLogo } from "../entities/project-logo";

// ── ProjectLogoStore ─────────────────────────────────────────────────────────
// One logo per project (AI-393), kept apart from the project record so project and board reads
// don't carry the file; the project only has `logoUpdatedAt`. Storage only: validation, the
// sanitizer and who may write live in the API's logo service. Any failure throws.

export interface ProjectLogoStore {
  /** The project's logo, or null when it has none. */
  get(projectId: string): Promise<ProjectLogo | null>;
  /** Stores the logo, replacing any earlier one. */
  put(logo: ProjectLogo): Promise<ProjectLogo>;
  /** Removes the logo; removing none is not an error. */
  remove(projectId: string): Promise<void>;
}
