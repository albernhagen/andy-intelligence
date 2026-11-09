import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { SetWorker, WorkerView } from "@andy/contracts";
import type { TicketService } from "@andy/domain";
import type { AuthEnv } from "./auth";

/** Who does a ticket's work (ADR-0082). Every caller here is Andy (allow-list), so actor = "andy". */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const errors = {
  400: json(ErrorBody, "Invalid request"),
  404: json(ErrorBody, "Not found"),
  409: json(ErrorBody, "Conflict"),
};
const params = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
  ticketId: z.uuid(),
});
const path = "/api/projects/{projectId}/tickets/{ticketId}/worker";

const getWorker = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path,
  request: { params },
  responses: { 200: json(WorkerView, "The ticket's resolved worker"), ...errors },
});

const putWorker = createRoute({
  security: [{ bearer: [] }],
  method: "put",
  path,
  request: {
    params,
    body: { content: { "application/json": { schema: SetWorker } }, required: true },
  },
  responses: { 200: json(WorkerView, "Stored; an agent ticket may start building"), ...errors },
});

export function registerWorkerRoutes(app: OpenAPIHono<AuthEnv>, service: TicketService): void {
  app.openapi(getWorker, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(await service.worker(projectId, ticketId), 200);
  });

  app.openapi(putWorker, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const { worker } = c.req.valid("json");
    return c.json(await service.setWorker(projectId, ticketId, worker, "andy"), 200);
  });
}
