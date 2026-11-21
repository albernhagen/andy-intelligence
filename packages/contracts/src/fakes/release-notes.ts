import { ReleaseNote } from "../entities/release-notes";
import {
  RELEASE_NOTE_LIST_MAX,
  type ReleaseNoteStore,
  type ReleaseNoteWindow,
} from "../ports/release-notes";

/** Newest merge first; the PR number breaks ties so the order is stable. */
export const newestMergeFirst = (a: ReleaseNote, b: ReleaseNote) =>
  b.mergedAt.localeCompare(a.mergedAt) || b.prNumber - a.prNumber;

/** In-memory ReleaseNoteStore (AI-159). */
export class InMemoryReleaseNoteStore implements ReleaseNoteStore {
  private readonly notes = new Map<string, ReleaseNote>();

  private key = (projectId: string, id: string) => `${projectId}/${id}`;

  async put(note: ReleaseNote): Promise<ReleaseNote> {
    const parsed = ReleaseNote.parse(note);
    this.notes.set(this.key(parsed.projectId, parsed.id), parsed);
    return structuredClone(parsed);
  }

  async create(note: ReleaseNote): Promise<"created" | "exists"> {
    const parsed = ReleaseNote.parse(note);
    const key = this.key(parsed.projectId, parsed.id);
    if (this.notes.has(key)) return "exists";
    this.notes.set(key, parsed);
    return "created";
  }

  async get(projectId: string, id: string): Promise<ReleaseNote | null> {
    const found = this.notes.get(this.key(projectId, id));
    return found ? structuredClone(found) : null;
  }

  async listForProject(projectId: string, window: ReleaseNoteWindow = {}): Promise<ReleaseNote[]> {
    const { since, until, limit = RELEASE_NOTE_LIST_MAX } = window;
    return [...this.notes.values()]
      .filter((n) => n.projectId === projectId)
      .filter(
        (n) =>
          (since === undefined || n.mergedAt >= since) &&
          (until === undefined || n.mergedAt < until),
      )
      .sort(newestMergeFirst)
      .slice(0, Math.min(limit, RELEASE_NOTE_LIST_MAX))
      .map((n) => structuredClone(n));
  }
}
