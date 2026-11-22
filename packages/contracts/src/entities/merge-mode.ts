import { z } from "zod";

/**
 * Who merges a project's PRs (ADR-0124), strictest first: `manual` (Andy merges everything),
 * `epic` (an epic's tickets merge into `epic/<KEY>`, Andy merges one PR per epic), `low-risk` (a clean PR
 * merges unless its diff touches the high-risk list), `all-clean` (a clean PR merges unless it
 * is a kept kind). Its own file so release notes can name it (AI-218).
 */
export const MergeMode = z.enum(["manual", "epic", "low-risk", "all-clean"]);
export type MergeMode = z.infer<typeof MergeMode>;
