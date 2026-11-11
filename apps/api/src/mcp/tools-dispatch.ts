import { Project } from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolDeps } from "./tools";

/** Andy's dispatch controls over MCP (ADR-0079); same rules as PATCH /api/projects/{id}. */

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const ProjectKey = z
  .string()
  .transform((k) => k.trim().toUpperCase())
  .pipe(Project.shape.key)
  .describe('Project key, e.g. "AI". Call `status` with no ticket to list projects.');

const RunsAtOnceInput = {
  project: ProjectKey,
  runs: Project.shape.runsAtOnce.unwrap().describe("Runs at once in this project: 1 to 4."),
};

const PausedInput = {
  project: ProjectKey,
  paused: z
    .boolean()
    .describe("true: dispatch starts nothing in this project; runs in flight finish."),
};

export function registerDispatchTools(server: McpServer, deps: ToolDeps, run: Run): void {
  server.registerTool(
    "set_runs_at_once",
    {
      description:
        "Sets how many runs a project may have in flight at once: 1 to 4, default 2. Applies to the next dispatch decision; a global cap across projects still holds.",
      inputSchema: RunsAtOnceInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ project, runs }) =>
      run(async () => {
        const updated = await deps.projects.update(
          project.toLowerCase(),
          { runsAtOnce: runs },
          { actor: deps.actor, email: deps.email },
        );
        return { project: updated.key, runsAtOnce: updated.runsAtOnce };
      }),
  );

  server.registerTool(
    "set_paused",
    {
      description:
        "Pauses or resumes a project's dispatch. Paused: refine and build start nothing on their own, runs in flight finish, and starting one by hand still works.",
      inputSchema: PausedInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ project, paused }) =>
      run(async () => {
        const updated = await deps.projects.update(
          project.toLowerCase(),
          { paused },
          {
            actor: deps.actor,
            email: deps.email,
          },
        );
        return { project: updated.key, paused: updated.paused };
      }),
  );
}
