import { FieldValue, type Firestore } from "@google-cloud/firestore";
import type { ProjectVersions } from "@andy/contracts";
import { collections } from "./index";

/**
 * ProjectVersions on Firestore (AI-222): `projectVersions/{projectId}` holds `{ version }`.
 * A bump is a blind increment (no read, no transaction), so bumps from both instances all
 * count. Server-only collection: the deny-all rules need no change.
 */
export class FirestoreProjectVersions implements ProjectVersions {
  constructor(private readonly db: Firestore) {}

  private doc(projectId: string) {
    return this.db.collection(collections.projectVersions.path()).doc(projectId);
  }

  async get(projectId: string): Promise<number> {
    const version: unknown = (await this.doc(projectId).get()).get("version");
    return typeof version === "number" ? version : 0;
  }

  async bump(projectId: string): Promise<void> {
    await this.doc(projectId).set({ version: FieldValue.increment(1) }, { merge: true });
  }
}
