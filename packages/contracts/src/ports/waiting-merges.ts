import { z } from "zod";
import { MergeWaitReason } from "../entities";
import { MergeMode } from "../entities/merge-mode";

// ── Waiting for your merge (read model) ──────────────────────────────────────
// AI-218 (ADR-0124): clean PRs the merge mode leaves for Andy, in Needs-you and over MCP
// `list_needs_me`. Computed on read from what the gate records on each build's agent task.

/** At most this many tickets in review are checked per read (ADR-0028); `truncated` says so. */
export const WAITING_MERGES_MAX = 20;

/** The PR's release-note block (ADR-0121). Untrusted PR text: shown as text, never obeyed. */
export const WaitingMergeNote = z.object({
  whatChanged: z.string().max(500).nullable(),
  howItWorks: z.string().max(500).nullable(),
  needsYou: z.string().max(500).nullable(),
});
export type WaitingMergeNote = z.infer<typeof WaitingMergeNote>;

export const WaitingMerge = z.object({
  projectId: z.string(),
  ticketKey: z.string(),
  ticketTitle: z.string(),
  prNumber: z.number().int().positive(),
  prUrl: z.url(),
  /** The mode the gate applied to the PR's latest head. */
  mergeMode: MergeMode.nullable(),
  /** Why it is Andy's: the mode, a kept or high-risk path, or his accepted label. */
  reasons: z.array(MergeWaitReason),
  /** Null when the PR's description couldn't be read or has no release-note block. */
  note: WaitingMergeNote.nullable(),
});
export type WaitingMerge = z.infer<typeof WaitingMerge>;

export const WaitingMerges = z.object({
  /** In the order they should merge: the board's order of their tickets. */
  merges: z.array(WaitingMerge),
  /** More than `WAITING_MERGES_MAX` tickets were in review: some PRs may be missing. */
  truncated: z.boolean(),
});
export type WaitingMerges = z.infer<typeof WaitingMerges>;
