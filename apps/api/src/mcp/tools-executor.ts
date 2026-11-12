import { ExecutorKind, Project, TicketKey, type EventActor } from "@andy/contracts";
import type { ProjectService, TicketService } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** MCP tools for where a ticket's runs execute (ADR-0089); the UI and REST API have the same controls. */

interface ExecutorToolDeps {
  service: TicketService;
  projects: ProjectService;
  email: string;
  actor: EventActor;
}

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const SetExecutorInput = {
  ticket: TicketKey.describe('Ticket key, e.g. "AI-42".'),
  executor: ExecutorKind.nullable().describe(
    "actions: runs on GitHub Actions. local: runs on Andy's local runner, and waits while no runner is present. null: clear the pick and follow the project's default.",
  ),
};

const SetDefaultExecutorInput = {
  project: z
    .string()
    .transform((k) => k.trim().toUpperCase())
    .pipe(Project.shape.key)
    .describe('Project key, e.g. "AI".'),
  executor: ExecutorKind.describe(
    "actions (default): runs on GitHub Actions. local: runs on Andy's local runner while one is present, else on Actions. Applies to every ticket without its own pick.",
  ),
};

export function registerExecutorTools(server: McpServer, deps: ExecutorToolDeps, run: Run): void {
  server.registerTool(
    "set_executor",
    {
      description:
        "Sets where a ticket's runs execute: actions, local (Andy's local runner; the ticket waits while no runner is present), or null to follow the project's default. A run in flight keeps its executor.",
      inputSchema: SetExecutorInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ ticket, executor }) =>
      run(async () => {
        const found = await deps.service.findByKey(ticket);
        return {
          ticket: found.key,
          ...(await deps.service.setExecutor(found.projectId, found.id, executor, deps.actor)),
        };
      }),
  );

  server.registerTool(
    "set_default_executor",
    {
      description:
        "Sets a project's default executor: actions (default) or local. With local, tickets without their own pick run on Andy's local runner while it is present and on Actions while it is away.",
      inputSchema: SetDefaultExecutorInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ project, executor }) =>
      run(async () => {
        const updated = await deps.projects.update(
          project.toLowerCase(),
          { executor },
          { actor: deps.actor, email: deps.email },
        );
        return { project: updated.key, executor: updated.executor };
      }),
  );
}
