import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  EpicBreakdown,
  EpicBreakdownDecision,
  EpicBreakdownProposal,
  Run,
  Ticket,
  WaitingEpicBreakdown,
} from "@andy/contracts";
import type { EpicBreakdownService, RunService } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * Epic breakdowns (AI-383, ADR-0155): a plan-epic agent task (`POST .../breakdown/agent-task`)
 * drafts a top-level epic's child tickets, or the owner submits them here or with MCP
 * `submit_epic_breakdown`; Andy approves (the tickets, in Ideas) or sends them back with a note.
 * Owner-only writes (`can`). MCP has the same controls (`tools-epic-breakdown.ts`).
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const secured = { security: [{ bearer: [] }] };
const TicketParams = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
  ticketId: z.uuid(),
});
const errors = {
  400: json(ErrorBody, "Invalid request"),
  403: json(ErrorBody, "Only the owner"),
  404: json(ErrorBody, "No such project or ticket"),
  409: json(
    ErrorBody,
    "Not decidable, or the epic can't take a breakdown (not a top-level epic, milestone not approved, one waits or was approved)",
  ),
};

export const BreakdownDecisionResult = z.object({
  breakdown: EpicBreakdown,
  tickets: z.array(Ticket),
});

const path = "/api/projects/{projectId}/tickets/{ticketId}/breakdown";
const routes = {
  get: createRoute({
    ...secured,
    method: "get",
    path,
    request: { params: TicketParams },
    responses: {
      200: json(
        z.object({ breakdown: EpicBreakdown.nullable() }),
        "The epic's breakdown; null: none yet",
      ),
      404: errors[404],
    },
  }),
  propose: createRoute({
    ...secured,
    method: "post",
    path,
    request: {
      params: TicketParams,
      body: { content: { "application/json": { schema: EpicBreakdownProposal } }, required: true },
    },
    responses: { 201: json(EpicBreakdown, "Stored as a proposal for Andy"), ...errors },
  }),
  decide: createRoute({
    ...secured,
    method: "post",
    path: `${path}/decision`,
    request: {
      params: TicketParams,
      body: { content: { "application/json": { schema: EpicBreakdownDecision } }, required: true },
    },
    responses: {
      200: json(BreakdownDecisionResult, "Decided; tickets created in Ideas on approval"),
      ...errors,
    },
  }),
  startTask: createRoute({
    ...secured,
    method: "post",
    path: `${path}/agent-task`,
    request: { params: TicketParams },
    responses: {
      201: json(Run, "A plan-epic agent task started; its result waits for Andy"),
      ...errors,
      409: json(
        ErrorBody,
        "The epic can't take a breakdown, a task is in flight, the epic used its drafting tasks, or a cap is reached",
      ),
      422: json(ErrorBody, "No repo"),
      502: json(ErrorBody, "The executor couldn't start it (GitHub not connected)"),
      503: json(ErrorBody, "No executor"),
    },
  }),
  waiting: createRoute({
    ...secured,
    method: "get",
    path: "/api/epic-breakdowns/waiting",
    responses: {
      200: json(z.array(WaitingEpicBreakdown), "Breakdowns waiting for Andy, every project"),
    },
  }),
};

export function registerEpicBreakdownRoutes(
  app: OpenAPIHono<AuthEnv>,
  breakdowns: EpicBreakdownService,
  runs: Pick<RunService, "requestEpicTask">,
): void {
  app.openapi(routes.startTask, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(await runs.requestEpicTask(projectId, ticketId, actorOf(c.get("identity"))), 201);
  });
  app.openapi(routes.get, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json({ breakdown: (await breakdowns.get(projectId, ticketId)).breakdown }, 200);
  });
  app.openapi(routes.propose, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(
      await breakdowns.propose(
        projectId,
        ticketId,
        c.req.valid("json"),
        actorOf(c.get("identity")),
      ),
      201,
    );
  });
  app.openapi(routes.decide, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(
      await breakdowns.decide(projectId, ticketId, c.req.valid("json"), actorOf(c.get("identity"))),
      200,
    );
  });
  app.openapi(routes.waiting, async (c) => c.json(await breakdowns.waiting(), 200));
}

/** Listed in `api-routes.ts` (AI-145); absent without a breakdown store. */
export const apiRoutes: RouteModule = (app, s) => {
  if (s.breakdowns) registerEpicBreakdownRoutes(app, s.breakdowns, s.runs);
};
