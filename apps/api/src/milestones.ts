import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  MILESTONE_NAME_MAX,
  MILESTONE_OUTCOME_MAX,
  Milestone,
  MilestoneId,
  MilestoneStatus,
  Ticket,
} from "@andy/contracts";
import type { MilestoneService } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * Milestones (ADR-0131, AI-304: M4.34), under /api (Firebase sign-in + allow-list; the project in
 * the path is checked by `project-access.ts`). Reads for anyone who can read the project; every
 * write is the owner's (`change_milestones`) and is a config change in the project's change log,
 * revertable there. The same `MilestoneService` serves the MCP milestone tools.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const secured = { security: [{ bearer: [] }] };
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });
const MilestoneParams = ProjectParams.extend({ milestoneId: MilestoneId });
const TicketParams = ProjectParams.extend({ ticketId: z.uuid() });
const Reason = z.string().max(500).optional();

export const CreateMilestone = z
  .strictObject({
    name: z.string().trim().min(1).max(MILESTONE_NAME_MAX),
    outcome: z.string().trim().min(1).max(MILESTONE_OUTCOME_MAX),
    order: z.number().int().min(0).max(10_000).optional(),
    reason: Reason,
  })
  .openapi("CreateMilestone");

export const PatchMilestone = z
  .strictObject({
    name: z.string().trim().min(1).max(MILESTONE_NAME_MAX).optional(),
    outcome: z.string().trim().min(1).max(MILESTONE_OUTCOME_MAX).optional(),
    order: z.number().int().min(0).max(10_000).optional(),
    status: MilestoneStatus.optional(),
    reason: Reason,
  })
  .openapi("PatchMilestone");

export const SetEpicMilestone = z
  .strictObject({ milestoneId: MilestoneId.nullable(), reason: Reason })
  .openapi("SetEpicMilestone");

const errors = {
  403: json(ErrorBody, "Only the owner writes milestones"),
  404: json(ErrorBody, "Unknown project, milestone or ticket"),
  409: json(ErrorBody, "The ticket changed since it was read"),
  422: json(ErrorBody, "Invalid, past the milestone cap, or the ticket can't hold a milestone"),
};

const routes = {
  list: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}/milestones",
    request: { params: ProjectParams },
    responses: {
      200: json(z.array(Milestone), "The project's milestones in roadmap order"),
      ...errors,
    },
  }),
  create: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/milestones",
    request: {
      params: ProjectParams,
      body: { content: { "application/json": { schema: CreateMilestone } }, required: true },
    },
    responses: { 201: json(Milestone, "Created, not reviewed, and logged"), ...errors },
  }),
  update: createRoute({
    ...secured,
    method: "patch",
    path: "/api/projects/{projectId}/milestones/{milestoneId}",
    request: {
      params: MilestoneParams,
      body: { content: { "application/json": { schema: PatchMilestone } }, required: true },
    },
    responses: { 200: json(Milestone, "Saved and logged"), ...errors },
  }),
  setEpic: createRoute({
    ...secured,
    method: "put",
    path: "/api/projects/{projectId}/tickets/{ticketId}/milestone",
    request: {
      params: TicketParams,
      body: { content: { "application/json": { schema: SetEpicMilestone } }, required: true },
    },
    responses: { 200: json(Ticket, "The epic, attached or detached, and logged"), ...errors },
  }),
};

export function registerMilestoneRoutes(
  app: OpenAPIHono<AuthEnv>,
  milestones: MilestoneService,
): void {
  app.openapi(routes.list, async (c) =>
    c.json(await milestones.list(c.req.valid("param").projectId), 200),
  );

  app.openapi(routes.create, async (c) => {
    const { reason, ...input } = c.req.valid("json");
    const created = await milestones.create(
      c.req.valid("param").projectId,
      input,
      actorOf(c.get("identity")),
      reason,
    );
    return c.json(created, 201);
  });

  app.openapi(routes.update, async (c) => {
    const { projectId, milestoneId } = c.req.valid("param");
    const { reason, ...patch } = c.req.valid("json");
    return c.json(
      await milestones.update(projectId, milestoneId, patch, actorOf(c.get("identity")), reason),
      200,
    );
  });

  app.openapi(routes.setEpic, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const { milestoneId, reason } = c.req.valid("json");
    return c.json(
      await milestones.setEpicMilestone(
        projectId,
        ticketId,
        milestoneId,
        actorOf(c.get("identity")),
        reason,
      ),
      200,
    );
  });
}

/** Listed in `api-routes.ts` (AI-145). Absent without a milestone store. */
export const apiRoutes: RouteModule = (app, s) => {
  if (s.milestones) registerMilestoneRoutes(app, s.milestones);
};
