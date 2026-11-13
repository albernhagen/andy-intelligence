import { PLAN_LIMITS, Project, ProjectPlanProposal, type EventActor } from "@andy/contracts";
import type { ProjectPlanService } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** MCP tools for project plans (AI-108, AI-65); the UI and REST API have the same controls. */

interface ProjectPlanToolDeps {
  plans?: ProjectPlanService;
  actor: EventActor;
}

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const ProjectKey = z
  .string()
  .transform((k) => k.trim().toUpperCase())
  .pipe(Project.shape.key)
  .describe('Project key, e.g. "TRL".');

export function registerProjectPlanTools(
  server: McpServer,
  deps: ProjectPlanToolDeps,
  run: Run,
): void {
  const plans = deps.plans;
  if (!plans) return;
  const id = (key: string) => key.toLowerCase();

  server.registerTool(
    "submit_project_plan",
    {
      description:
        "Owner only. Stores a new project's plan (the result of platform/procedures/plan-project.md: summary and milestones in completion order) as a proposal for Andy. Creates no tickets. Refused while another proposal waits or once a plan is approved.",
      inputSchema: { project: ProjectKey, plan: ProjectPlanProposal },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ project, plan }) => run(() => plans.propose(id(project), plan, deps.actor)),
  );

  server.registerTool(
    "approve_project_plan",
    {
      description:
        "Owner only. Approves the project's waiting plan: creates one epic per milestone, in order, titled M<N>: <title>.",
      inputSchema: { project: ProjectKey },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ project }) => run(() => plans.decide(id(project), { decision: "approved" }, deps.actor)),
  );

  server.registerTool(
    "reject_project_plan",
    {
      description:
        "Owner only. Rejects the project's waiting plan with a reason; no tickets are created. A new plan can then be submitted.",
      inputSchema: {
        project: ProjectKey,
        reason: z
          .string()
          .trim()
          .min(1)
          .max(PLAN_LIMITS.reason)
          .describe("Why, for the next plan."),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ project, reason }) =>
      run(() => plans.decide(id(project), { decision: "rejected", reason }, deps.actor)),
  );
}
