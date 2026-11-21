import type { Firestore } from "@google-cloud/firestore";
import {
  RELEASE_NOTE_LIST_MAX,
  ReleaseNote,
  type ReleaseNoteStore,
  type ReleaseNoteWindow,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * ReleaseNoteStore on Firestore (AI-159, ADR-0121): `projects/{projectId}/releaseNotes/pr-<n>`,
 * beside the project's tickets. A window read filters and orders on `mergedAt` only, which the
 * automatic single-field index serves: no composite index, no rules change (server-only data).
 */
export class FirestoreReleaseNoteStore implements ReleaseNoteStore {
  constructor(private readonly db: Firestore) {}

  private notes(projectId: string) {
    return typedCollection(this.db, collections.releaseNotes.path(projectId), ReleaseNote);
  }

  async put(note: ReleaseNote): Promise<ReleaseNote> {
    const parsed = ReleaseNote.parse(note);
    await this.notes(parsed.projectId).doc(parsed.id).set(parsed);
    return parsed;
  }

  /** `create` refuses an existing id, so the backfill never overwrites a stored note. */
  async create(note: ReleaseNote): Promise<"created" | "exists"> {
    const parsed = ReleaseNote.parse(note);
    try {
      await this.notes(parsed.projectId).doc(parsed.id).create(parsed);
      return "created";
    } catch (err) {
      // gRPC ALREADY_EXISTS (6).
      if ((err as { code?: number }).code === 6) return "exists";
      throw err;
    }
  }

  async get(projectId: string, id: string): Promise<ReleaseNote | null> {
    const snap = await this.notes(projectId).doc(id).get();
    return snap.exists ? (snap.data() ?? null) : null;
  }

  async listForProject(projectId: string, window: ReleaseNoteWindow = {}): Promise<ReleaseNote[]> {
    const { since, until, limit = RELEASE_NOTE_LIST_MAX } = window;
    let query = this.notes(projectId).orderBy("mergedAt", "desc");
    if (since !== undefined) query = query.where("mergedAt", ">=", since);
    if (until !== undefined) query = query.where("mergedAt", "<", until);
    const snap = await query.limit(Math.min(limit, RELEASE_NOTE_LIST_MAX)).get();
    // Ties on `mergedAt` (rare) get the same order as the fake.
    return snap.docs
      .map((d) => d.data())
      .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt) || b.prNumber - a.prNumber);
  }
}
