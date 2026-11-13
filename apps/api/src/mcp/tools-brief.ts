import { BriefAnswers, Project, type EventActor } from "@andy/contracts";
import type { BriefService } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** MCP tool for the project brief (AI-107, ADR-0053); the REST API has the same route. */

interface BriefToolDeps {
  brief?: BriefService;
  actor: EventActor;
}

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const SubmitBriefInput = {
  project: z
    .string()
    .transform((k) => k.trim().toUpperCase())
    .pipe(Project.shape.key)
    .describe('Project key, e.g. "AI".'),
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
}
