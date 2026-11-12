import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { SetExecutor, ExecutorView } from "@andy/contracts";
import type { TicketService } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";

/** Where a ticket's runs execute (ADR-0089). The actor is the signed-in user; TicketService checks it may. */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const errors = {
  400: json(ErrorBody, "Invalid request"),
  403: json(ErrorBody, "Only the owner sets the executor"),
  404: json(ErrorBody, "Not found"),
  409: json(ErrorBody, "Conflict"),
};
const params = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
  ticketId: z.uuid(),
});
const path = "/api/projects/{projectId}/tickets/{ticketId}/executor";

const getExecutor = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path,
  request: { params },
  responses: { 200: json(ExecutorView, "Where the ticket's agent tasks run"), ...errors },
});

const putExecutor = createRoute({
  security: [{ bearer: [] }],
  method: "put",
  path,
  request: {
    params,
    body: { content: { "application/json": { schema: SetExecutor } }, required: true },
  },
  responses: {
    200: json(ExecutorView, "Stored; applies to the ticket's next agent task"),
    ...errors,
  },
});

export function registerExecutorRoutes(app: OpenAPIHono<AuthEnv>, service: TicketService): void {
  app.openapi(getExecutor, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(await service.executor(projectId, ticketId), 200);
  });

  app.openapi(putExecutor, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const { executor } = c.req.valid("json");
    return c.json(
      await service.setExecutor(projectId, ticketId, executor, actorOf(c.get("identity"))),
      200,
    );
  });
}
