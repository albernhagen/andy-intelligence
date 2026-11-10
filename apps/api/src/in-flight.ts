import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { InFlightRun } from "@andy/contracts";
import type { RunService } from "@andy/domain";
import type { AuthEnv } from "./auth";

/** The in-flight view (ADR-0080): the project's runs in flight and what they touch. Read-only. */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

const inFlightRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/in-flight",
  request: { params: ProjectParams },
  responses: {
    200: json(z.array(InFlightRun), "Runs in flight, oldest first, with their touched files"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

export function registerInFlightRoutes(app: OpenAPIHono<AuthEnv>, runs: RunService): void {
  app.openapi(inFlightRoute, async (c) =>
    c.json(await runs.inFlight(c.req.valid("param").projectId), 200),
  );
}
