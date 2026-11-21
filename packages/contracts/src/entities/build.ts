import { z } from "zod";

/**
 * Epic branch builds (AI-122, ADR-0049): a build for a story in a running night launch branches
 * from `epic/<KEY>` and opens its PR against it instead of the default branch. The base branch is
 * only ever this pattern, built from the launch's epic key, never taken from ticket or PR text.
 * The executor workflow and `scripts/executor-publish.mjs` check the same pattern again.
 */
export const EPIC_BRANCH_PATTERN = /^epic\/[A-Z][A-Z0-9]{0,9}-[0-9]{1,9}$/;

export const BaseBranch = z.string().regex(EPIC_BRANCH_PATTERN);
export type BaseBranch = z.infer<typeof BaseBranch>;

/** `epic/<KEY>` for an epic's key; throws on a key that wouldn't make a valid branch. */
export function epicBranchName(epicKey: string): BaseBranch {
  return BaseBranch.parse(`epic/${epicKey}`);
}

/** Spread into `Run`. The default keeps older documents readable (no schema version bump). */
export const runBaseFields = {
  /** A build's base branch; null means the repo's default branch, as before. */
  baseBranch: BaseBranch.nullable().default(null),
};
