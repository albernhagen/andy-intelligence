import { z } from "zod";
import { Id, Timestamp } from "./common";
import { MergeMode } from "./merge-mode";
import { Risk } from "./scores";

/**
 * Release notes (AI-159, ADR-0121): one per pull request merged into a project's default branch,
 * stored when the merge arrives. The text fields come from the PR description, written by its
 * author (often an agent): untrusted, capped, shown as plain text, never given to an agent as
 * instructions.
 */

/** Caps (ADR-0028). Field text is cut to `text` characters; word caps are the PR check's. */
export const RELEASE_NOTE_LIMITS = { text: 400, title: 256, links: 10, path: 200 } as const;

/**
 * Where a note came from. `note`: the PR's release-note block. `no_note`: the PR had none, so it
 * is listed by its title. `backfill`: written by the one-off backfill from a PR merged before the
 * block existed (its "What changed" is the summary's first sentence).
 */
export const ReleaseNoteSource = z.enum(["note", "no_note", "backfill"]);
export type ReleaseNoteSource = z.infer<typeof ReleaseNoteSource>;

/** A doc the PR touched that explains more: a feature file, an ADR or a runbook. */
export const ReleaseNoteLinkKind = z.enum(["feature", "adr", "runbook"]);
export type ReleaseNoteLinkKind = z.infer<typeof ReleaseNoteLinkKind>;

export const ReleaseNoteLink = z.object({
  kind: ReleaseNoteLinkKind,
  path: z.string().min(1).max(RELEASE_NOTE_LIMITS.path),
  url: z.url(),
});
export type ReleaseNoteLink = z.infer<typeof ReleaseNoteLink>;

const text = z.string().max(RELEASE_NOTE_LIMITS.text);

export const ReleaseNote = z.object({
  /** `pr-<number>`: one note per PR, so a redelivery or a rerun writes the same document. */
  id: z.string().regex(/^pr-\d{1,9}$/),
  projectId: Id,
  prNumber: z.number().int().positive(),
  prUrl: z.url(),
  prTitle: z.string().max(RELEASE_NOTE_LIMITS.title),
  ticketKey: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{0,9}-\d+$/)
    .nullable(),
  ticketTitle: z.string().max(RELEASE_NOTE_LIMITS.title).nullable(),
  /** The ticket's risk when it merged (ADR-0088: who may merge it); null when unscored. */
  risk: Risk.nullable(),
  mergedAt: Timestamp,
  /** The code host login that merged it, e.g. a person or "andy-intelligence[bot]" (the gate). */
  mergedBy: z.string().max(100).nullable(),
  /**
   * The merge mode the gate merged it under (AI-218, ADR-0124 "Record"); null when a person
   * merged it, or for notes recorded before AI-218.
   */
  mergedByMode: MergeMode.nullable().default(null),
  source: ReleaseNoteSource,
  /** Null only for `no_note`. */
  whatChanged: text.nullable(),
  howItWorks: text.nullable(),
  needsYou: text.nullable(),
  links: z.array(ReleaseNoteLink).max(RELEASE_NOTE_LIMITS.links),
  recordedAt: Timestamp,
});
export type ReleaseNote = z.infer<typeof ReleaseNote>;

export const releaseNoteId = (prNumber: number) => `pr-${prNumber}`;

/** What the code host says about a PR beyond `PullRequest`: its description and merge. */
export const PullRequestDetails = z.object({
  /** Untrusted text, capped by the adapter. */
  body: z.string().max(20_000),
  mergedBy: z.string().max(100).nullable(),
  mergedAt: Timestamp.nullable(),
});
export type PullRequestDetails = z.infer<typeof PullRequestDetails>;
