import type { Firestore } from "@google-cloud/firestore";
import { ProjectLogo, type ProjectLogoStore } from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * ProjectLogoStore on Firestore (AI-393): `projectLogos/{projectId}`, one document per project,
 * at most a ~171 KB string (well under the 1 MiB document limit). Point reads only: no index, no
 * rules change (server-only data). A new collection: no SCHEMA_VERSION bump.
 */
export class FirestoreProjectLogoStore implements ProjectLogoStore {
  constructor(private readonly db: Firestore) {}

  private logos() {
    return typedCollection(this.db, collections.projectLogos.path(), ProjectLogo);
  }

  async get(projectId: string): Promise<ProjectLogo | null> {
    return (await this.logos().doc(projectId).get()).data() ?? null;
  }

  async put(logo: ProjectLogo): Promise<ProjectLogo> {
    const parsed = ProjectLogo.parse(logo);
    await this.logos().doc(parsed.projectId).set(parsed);
    return parsed;
  }

  async remove(projectId: string): Promise<void> {
    await this.logos().doc(projectId).delete();
  }
}
