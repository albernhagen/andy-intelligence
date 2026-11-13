import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  Project,
  ProjectPlan,
  ProjectPlanDecision,
  ProjectPlanProposal,
  Ticket,
} from "@andy/contracts";
import type { ProjectPlanService } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";

/**
 * Project plans (AI-108, AI-65): the plan-project result goes in as a proposal; Andy approves
 * (one epic per milestone) or rejects with a reason. Owner-only (`can`). Until AI-134 wires the
 * plan-project agent task, the result is submitted here or with MCP `submit_project_plan`.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const secured = { security: [{ bearer: [] }] };
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });
const errors = {
  400: json(ErrorBody, "Invalid request"),
  403: json(ErrorBody, "Only the owner"),
  404: json(ErrorBody, "No such project"),
  409: json(ErrorBody, "No plan to decide, or one waits or is approved already"),
};

export const WaitingPlanView = z.object({
  projectId: Project.shape.id,
  key: Project.shape.key,
  name: Project.shape.name,
  plan: ProjectPlan,
});
export const PlanDecisionResult = z.object({ plan: ProjectPlan, epics: z.array(Ticket) });

const routes = {
  get: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}/plan",
    request: { params: ProjectParams },
    responses: {
      200: json(z.object({ plan: ProjectPlan.nullable() }), "The project's plan; null: none yet"),
      404: errors[404],
    },
  }),
  propose: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/plan",
    request: {
      params: ProjectParams,
      body: { content: { "application/json": { schema: ProjectPlanProposal } }, required: true },
    },
    responses: { 201: json(ProjectPlan, "Stored as a proposal for Andy"), ...errors },
  }),
  decide: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/plan/decision",
    request: {
      params: ProjectParams,
      body: { content: { "application/json": { schema: ProjectPlanDecision } }, required: true },
    },
    responses: { 200: json(PlanDecisionResult, "Decided; epics created on approval"), ...errors },
  }),
  waiting: createRoute({
    ...secured,
    method: "get",
    path: "/api/project-plans/waiting",
    responses: { 200: json(z.array(WaitingPlanView), "Plans waiting for Andy, every project") },
  }),
};

export function registerProjectPlanRoutes(
  app: OpenAPIHono<AuthEnv>,
  plans: ProjectPlanService,
): void {
  app.openapi(routes.get, async (c) =>
    c.json({ plan: await plans.get(c.req.valid("param").projectId) }, 200),
  );
  app.openapi(routes.propose, async (c) =>
    c.json(
      await plans.propose(
        c.req.valid("param").projectId,
        c.req.valid("json"),
        actorOf(c.get("identity")),
      ),
      201,
    ),
  );
  app.openapi(routes.decide, async (c) =>
    c.json(
      await plans.decide(
        c.req.valid("param").projectId,
        c.req.valid("json"),
        actorOf(c.get("identity")),
      ),
      200,
    ),
  );
  app.openapi(routes.waiting, async (c) => c.json(await plans.waiting(), 200));
}
