import { IDEATE_LIMITS, IdeateOutput, Project, type EventActor } from "@andy/contracts";
import type { IdeateService } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** MCP tool for ideation (AI-114, ADR-0050); the REST API has the same route. */

interface IdeateToolDeps {
  ideate?: IdeateService;
  actor: EventActor;
}

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const IdeateInput = {
  project: z
    .string()
    .transform((k) => k.trim().toUpperCase())
    .pipe(Project.shape.key)
    .describe('Project key, e.g. "AI".'),
  idea: z.string().trim().min(1).max(IDEATE_LIMITS.idea).describe("The idea, in Andy's words."),
  result: IdeateOutput.describe(
    "Your result of platform/procedures/ideate.md for this idea and the project's brief (docs/product/brief.md).",
  ),
};

export function registerIdeateTools(server: McpServer, deps: IdeateToolDeps, run: Run): void {
  const ideate = deps.ideate;
  if (!ideate) return;
  server.registerTool(
    "ideate",
    {
      description:
        "Owner only. Turns an idea into an epic: first follow platform/procedures/ideate.md yourself (read the project's brief), then call this with the idea and your result. outcome epic: creates the epic in Ideas and opens a PR with the specs/<slug>.md draft. outcome question (the idea contradicts the brief): creates an Ideas ticket with the question in Needs-you, no epic. At most 10 spec PRs an hour.",
      inputSchema: IdeateInput,
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ project, idea, result }) =>
      run(() => ideate.submit(project.toLowerCase(), { idea, result }, deps.actor)),
  );
}
