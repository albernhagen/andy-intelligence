import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { ReadyFilters, ReadyList, type WorkTracker } from "@andy/contracts";
import { readyList } from "@andy/domain";
import type { AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * The ranked Ready list (AI-298: Parity: ranked Ready list in the web UI): the same read as MCP
 * `list_ready`, so the web shows the same tickets in the same order. Read-only.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

const readyRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/ready",
  request: { params: ProjectParams, query: ReadyFilters },
  responses: {
    200: json(ReadyList, "Ready tickets in rank order with their scores, at most 100"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

export function registerReadyRoutes(app: OpenAPIHono<AuthEnv>, tracker: WorkTracker): void {
  app.openapi(readyRoute, async (c) =>
    c.json(await readyList(tracker, c.req.valid("param").projectId, c.req.valid("query")), 200),
  );
}

/** Listed in `api-routes.ts` (AI-145). */
export const apiRoutes: RouteModule = (app, s) => registerReadyRoutes(app, s.deps.tracker);
