import { IDEATE_LIMITS, Project, type EventActor, type Run as AgentTask } from "@andy/contracts";
import type { RunService } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * MCP tools that start project-level agent tasks (AI-320; AI-134 built them): plan-project and
 * ideate. Each calls `RunService.requestProjectTask`, as `POST …/plan/agent-task` and
 * `POST …/ideate/agent-task` do: owner only, one of each in flight per project, the
 * agent-tasks-at-once dial, the global cap and the spend reservation, with the same refusals.
 */

interface ProjectTaskToolDeps {
  runs: Pick<RunService, "requestProjectTask">;
  actor: EventActor;
}

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const ProjectKey = z
  .string()
  .transform((k) => k.trim().toUpperCase())
  .pipe(Project.shape.key)
  .describe('Project key, e.g. "AI".');

/** What `build` and `refine` return about a started task, so every start reads the same. */
const started = (task: AgentTask) => ({
  run: {
    id: task.id,
    step: task.step,
    status: task.status,
    model: task.route.model,
    deadline: task.deadline,
    link: task.links.executorRun ?? null,
  },
});

export function registerProjectTaskTools(
  server: McpServer,
  deps: ProjectTaskToolDeps,
  run: Run,
): void {
  const id = (key: string) => key.toLowerCase();

  server.registerTool(
    "start_plan_project",
    {
      description:
        "Owner only. Starts a plan-project agent task now: an agent reads the project's brief read-only, follows platform/procedures/plan-project.md and stores its plan as a proposal for Andy (Needs-you), as `submit_project_plan` would (about 10-40 minutes). Spends Claude quota. Refused while a plan waits or is approved, while a plan-project task is in flight, at the agent-tasks-at-once dial or the cap across projects, or without a repo or GitHub connection.",
      inputSchema: { project: ProjectKey },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ project }) =>
      run(async () =>
        started(await deps.runs.requestProjectTask(id(project), "plan-project", {}, deps.actor)),
      ),
  );

  server.registerTool(
    "start_ideate",
    {
      description:
        "Owner only. Starts an ideate agent task on an idea now: an agent reads the project's brief read-only, follows platform/procedures/ideate.md and records the result as `ideate` would: an epic in Ideas with a spec draft PR, or an Ideas ticket with one question (about 10-40 minutes). Use it instead of running the procedure yourself. Spends Claude quota. Refused while an ideate task is in flight, at the agent-tasks-at-once dial or the cap across projects, or without a repo or GitHub connection; the hourly cap on ideas applies when it records.",
      inputSchema: {
        project: ProjectKey,
        idea: z
          .string()
          .trim()
          .min(1)
          .max(IDEATE_LIMITS.idea)
          .describe("The idea, in Andy's words."),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ project, idea }) =>
      run(async () =>
        started(await deps.runs.requestProjectTask(id(project), "ideate", { idea }, deps.actor)),
      ),
  );
}
