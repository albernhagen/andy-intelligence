import { z } from "zod";
import { Timestamp } from "../entities/common";
import { ReleaseNote } from "../entities/release-notes";

// ── ReleaseNoteStore ─────────────────────────────────────────────────────────
// One release note per PR merged into a project's default branch (AI-159, ADR-0121).

/** At most this many notes per `listForProject` call (ADR-0028). */
export const RELEASE_NOTE_LIST_MAX = 200;

export interface ReleaseNoteWindow {
  /** Inclusive lower bound on `mergedAt`; none when unset. */
  since?: string;
  /** Exclusive upper bound on `mergedAt`; none when unset. */
  until?: string;
  /** Capped at RELEASE_NOTE_LIST_MAX. */
  limit?: number;
}

export interface ReleaseNoteStore {
  /** Stores the note under its id, replacing any note for the same PR (a redelivery). */
  put(note: ReleaseNote): Promise<ReleaseNote>;
  /** Stores the note only when the PR has none yet (the backfill never overwrites). */
  create(note: ReleaseNote): Promise<"created" | "exists">;
  get(projectId: string, id: string): Promise<ReleaseNote | null>;
  /** The project's notes merged inside the window, newest merge first, at most `limit`. */
  listForProject(projectId: string, window?: ReleaseNoteWindow): Promise<ReleaseNote[]>;
}

// ── What's new (read model) ──────────────────────────────────────────────────
// The What's new page and the MCP `whats_new` tool: project status per milestone epic, then the
// window's release notes. Computed on read, never stored.

/** Default and longest window, in days (ADR-0028: bounds one read). */
export const WHATS_NEW_DEFAULT_DAYS = 14;
export const WHATS_NEW_MAX_DAYS = 90;
/** Tickets named under "Needs you" (the count covers all). */
export const WHATS_NEW_NEEDS_YOU_MAX = 10;

export const WhatsNewMilestone = z.object({
  key: z.string(),
  title: z.string(),
  done: z.number().int(),
  inReview: z.number().int(),
  inProgress: z.number().int(),
  notStarted: z.number().int(),
  /** Its tickets waiting on Andy. */
  needsYou: z.number().int(),
});
export type WhatsNewMilestone = z.infer<typeof WhatsNewMilestone>;

export const WhatsNewNote = ReleaseNote.extend({
  /** The top-level epic over the note's ticket, read now (tickets can move). */
  epicKey: z.string().nullable(),
  epicTitle: z.string().nullable(),
});
export type WhatsNewNote = z.infer<typeof WhatsNewNote>;

export const WhatsNew = z.object({
  projectKey: z.string(),
  window: z.object({ from: Timestamp, to: Timestamp }),
  /** Every top-level epic with tickets under it, in board order. */
  milestones: z.array(WhatsNewMilestone),
  needsYou: z.object({
    count: z.number().int(),
    tickets: z.array(z.object({ key: z.string(), title: z.string() })),
  }),
  /** Newest merge first; only the filtered epic's when `epic` was given. */
  notes: z.array(WhatsNewNote),
  /** The note read cap was reached: older notes in the window are missing. */
  truncated: z.boolean(),
});
export type WhatsNew = z.infer<typeof WhatsNew>;
