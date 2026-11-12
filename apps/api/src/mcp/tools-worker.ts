import { Project, TicketKey, Worker, WorkerChoice, type EventActor } from "@andy/contracts";
import type { ProjectService, TicketService } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** MCP tools for who does a ticket's work (ADR-0082); the UI and REST API have the same controls. */

interface WorkerToolDeps {
  service: TicketService;
  projects: ProjectService;
  email: string;
  actor: EventActor;
}

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const SetWorkerInput = {
  ticket: TicketKey.describe('Ticket key, e.g. "AI-42".'),
  worker: WorkerChoice.nullable().describe(
    "agent: agents may build it. me: Andy does it, no build starts. null: clear the pick and follow the project's default.",
  ),
};

const SetDefaultWorkerInput = {
  project: z
    .string()
    .transform((k) => k.trim().toUpperCase())
    .pipe(Project.shape.key)
    .describe('Project key, e.g. "AI".'),
  worker: Worker.describe(
    "agent (default): agents build. me: Andy does the work. ask: no worker until Andy picks one, so nothing builds. Applies to every ticket without its own pick.",
  ),
};

export function registerWorkerTools(server: McpServer, deps: WorkerToolDeps, run: Run): void {
  server.registerTool(
    "set_worker",
    {
      description:
        "Sets who does a ticket's work: agent, me (Andy; no build starts), or null to follow the project's default. Refine isn't affected. Switching a Ready ticket to agent can start its build when the project's auto-build is on.",
      inputSchema: SetWorkerInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ ticket, worker }) =>
      run(async () => {
        const found = await deps.service.findByKey(ticket);
        return {
          ticket: found.key,
          ...(await deps.service.setWorker(found.projectId, found.id, worker, deps.actor)),
        };
      }),
  );

  server.registerTool(
    "set_default_worker",
    {
      description:
        "Sets a project's default worker: agent (default), me or ask. Applies to every ticket without its own pick, whatever its stage.",
      inputSchema: SetDefaultWorkerInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ project, worker }) =>
      run(async () => {
        const updated = await deps.projects.update(
          project.toLowerCase(),
          { defaultWorker: worker },
          { actor: deps.actor, email: deps.email },
        );
        return { project: updated.key, defaultWorker: updated.defaultWorker };
      }),
  );
}
