import { Project } from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MERGE_PR_HOURLY_CAP } from "../merge";
import type { Run, ToolDeps } from "./tools";

/**
 * MCP `merge_pr` (AI-220, ADR-0124): coordinator sessions merge session PRs only through this
 * tool, which applies the project's merge mode and merges with the App's identity. Owner only.
 */

const MergePrInput = {
  project: z
    .string()
    .transform((k) => k.trim().toUpperCase())
    .pipe(Project.shape.key)
    .describe('Project key, e.g. "AI".'),
  repo: z.string().trim().min(3).max(200).describe('One of the project\'s repos, "owner/name".'),
  number: z.number().int().positive().max(1_000_000_000).describe("The pull request's number."),
};

export function registerMergeTools(
  server: McpServer,
  deps: Pick<ToolDeps, "merges" | "actor">,
  run: Run,
): void {
  const merges = deps.merges;
  if (!merges) return;
  server.registerTool(
    "merge_pr",
    {
      description: `Merges one PR of a project's repo when its merge mode allows (ADR-0124), with the App's identity, squash, pinned to the head it judged; else answers verdict "wait" with every reason (reasons, and gateReasons for checks, draft or branch). Clean means: every check and both review agents passed on the head, the head contains the latest default branch, no open review finding or accepted label, the PR's ticket is in Ready for review, and nothing on the kept list (or, in low-risk mode, the high-risk list). A clean PR, or one clean but behind, goes into the repo's merge queue (shared with the gate): it answers merged, or queued with queuePosition and queueNote, and merges later as the queue's head after a sync and green checks; a moved head or base never merges unjudged. Build agents' PRs are the gate's. Only Andy. At most ${MERGE_PR_HOURLY_CAP} calls per project per hour. Coordinator sessions merge only through this tool.`,
      inputSchema: MergePrInput,
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    ({ project, repo, number }) =>
      run(() => merges.merge({ projectId: project.toLowerCase(), repo, number }, deps.actor)),
  );
}
