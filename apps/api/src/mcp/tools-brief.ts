import { BriefAnswers, Project, type EventActor } from "@andy/contracts";
import type { BriefService } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** MCP tools for the project brief (AI-107, ADR-0053; the read: AI-373); the REST API has the same routes. */

interface BriefToolDeps {
  brief?: BriefService;
  actor: EventActor;
}

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const ProjectKey = z
  .string()
  .transform((k) => k.trim().toUpperCase())
  .pipe(Project.shape.key)
  .describe('Project key, e.g. "AI".');

const SubmitBriefInput = {
  project: ProjectKey,
  answers: BriefAnswers.describe(
    "The onboarding interview's answers, one field per question in platform/procedures/onboard.md.",
  ),
};

export function registerBriefTools(server: McpServer, deps: BriefToolDeps, run: Run): void {
  const brief = deps.brief;
  if (!brief) return;
  server.registerTool(
    "submit_brief",
    {
      description:
        "Owner only. Renders the project brief (docs/product/brief.md) from the onboarding answers and opens a PR on the project's repo; Andy merges it. Follow platform/procedures/onboard.md to collect the answers. A section over its word cap is refused by name. Same brief as on the default branch: no PR. At most 5 brief PRs an hour.",
      inputSchema: SubmitBriefInput,
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ project, answers }) => run(() => brief.submit(project.toLowerCase(), answers, deps.actor)),
  );
  server.registerTool(
    "brief_status",
    {
      description:
        "Owner only. Whether the project brief (docs/product/brief.md) is on the repo's default branch, and discovery's answers that prefill it (docs/product/discovery.md), as the setup path shows them. Unreadable, with the reason, when the project has no repo or GitHub isn't connected.",
      inputSchema: { project: ProjectKey },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ project }) => run(() => brief.status(project.toLowerCase(), deps.actor)),
  );
}
