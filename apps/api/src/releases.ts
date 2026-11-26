import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { DEPLOYMENT_LIMITS, ReleaseEnvironment, ReleaseListing } from "@andy/contracts";
import type { ReleaseReader } from "@andy/domain";
import type { AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * Releases (AI-183: M6.9, ADR-0114): a project's deployments to one environment, newest first,
 * each with the tickets it shipped and its release notes. Read-only; promote and rollback are
 * AI-199: M6.12.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

/** The environment and page size, shared with the MCP tool. */
export const ReleasesQuery = z.object({
  env: ReleaseEnvironment.default("prod").describe(
    "The environment: prod (default) or dev. PR previews have no releases.",
  ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(DEPLOYMENT_LIMITS.maxPage)
    .optional()
    .describe(
      `Deployments to list, newest first: default ${DEPLOYMENT_LIMITS.defaultPage}, at most ${DEPLOYMENT_LIMITS.maxPage}.`,
    ),
});

const releasesRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/releases",
  request: { params: ProjectParams, query: ReleasesQuery },
  responses: {
    200: json(ReleaseListing, "Deployments newest first, each with its tickets and release notes"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

export function registerReleaseRoutes(app: OpenAPIHono<AuthEnv>, reader: ReleaseReader): void {
  app.openapi(releasesRoute, async (c) => {
    const { env, limit } = c.req.valid("query");
    return c.json(await reader.list(c.req.valid("param").projectId, env, limit), 200);
  });
}

/** Listed in `api-routes.ts` (AI-145); absent without a deployment or release-note store. */
export const apiRoutes: RouteModule = (app, s) => {
  if (s.releases) registerReleaseRoutes(app, s.releases);
};
