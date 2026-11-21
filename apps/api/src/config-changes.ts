import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { CONFIG_CHANGE_LIST_MAX, ConfigChange, Project } from "@andy/contracts";
import type { ConfigRevert } from "@andy/domain";
import { signedIn, type AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * A project's settings change log and its revert (M4.12), under /api (Firebase sign-in +
 * allow-list), the same ConfigRevert rules as MCP. Reverting is owner-only (the project-settings
 * rule) and is itself logged as a new change; refused (409) when a field changed since.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const secured = { security: [{ bearer: [] }] };
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });
const ChangeParams = ProjectParams.extend({
  changeId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
});
const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(CONFIG_CHANGE_LIST_MAX).optional(),
});

export const RevertResult = z.object({ project: Project, reverted: ConfigChange });

const routes = {
  list: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}/config-changes",
    request: { params: ProjectParams, query: ListQuery },
    responses: {
      200: json(z.array(ConfigChange), "The project's settings changes, newest first (capped)"),
      404: json(ErrorBody, "Unknown project"),
    },
  }),
  revert: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/config-changes/{changeId}/revert",
    request: { params: ChangeParams },
    responses: {
      200: json(RevertResult, "Before values written (logged as a new change); original reverted"),
      403: json(ErrorBody, "Only the owner changes project settings"),
      404: json(ErrorBody, "Unknown project or change"),
      409: json(ErrorBody, "Not revertible: not applied, or a field changed since"),
    },
  }),
};

export function registerConfigChangeRoutes(app: OpenAPIHono<AuthEnv>, revert: ConfigRevert): void {
  app.openapi(routes.list, async (c) =>
    c.json(await revert.list(c.req.valid("param").projectId, c.req.valid("query").limit), 200),
  );

  app.openapi(routes.revert, async (c) => {
    const { projectId, changeId } = c.req.valid("param");
    return c.json(
      await revert.revert(projectId, changeId, signedIn(c.get("identity")), "app"),
      200,
    );
  });
}

/** Listed in `api-routes.ts` (AI-145); absent when the config-change store is not configured. */
export const apiRoutes: RouteModule = (app, s) => {
  if (s.configRevert) registerConfigChangeRoutes(app, s.configRevert);
};
