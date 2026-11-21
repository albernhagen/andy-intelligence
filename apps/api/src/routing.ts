import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { RoutingConfig, RoutingProjectId, Timestamp } from "@andy/contracts";
import type { RoutingSettings } from "@andy/domain";
import { signedIn, type AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * Model routing settings (AI-239: M9.7) under /api (Firebase sign-in + allow-list): read the
 * global and each project's routing, save either. Saving is owner-only (`change_routing`); every
 * route must pass `routeProblem` and a project config may only narrow global (422 naming each
 * problem). A stale `ifUpdatedAt` is a 409. Each accepted save writes one ConfigChange.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const secured = { security: [{ bearer: [] }] };

const ProjectRoutingView = z.object({
  projectId: RoutingProjectId,
  /** The project's own config; null when it follows global. */
  config: RoutingConfig.nullable(),
  effective: RoutingConfig,
});
export const RoutingView = z.object({
  global: RoutingConfig,
  projects: z.array(ProjectRoutingView),
});

const RoutingSave = z.object({
  providers: RoutingConfig.shape.providers,
  tiers: RoutingConfig.shape.tiers,
  steps: RoutingConfig.shape.steps,
  /** The `updatedAt` read; null when none was stored. Anything else stale is a 409. */
  ifUpdatedAt: Timestamp.nullable(),
  reason: z.string().max(500).optional(),
});

const errors = {
  403: json(ErrorBody, "Only the owner changes routing"),
  409: json(ErrorBody, "The routing changed since it was read"),
  422: json(ErrorBody, "A route can't run, or a project config is wider than global"),
};

const routes = {
  get: createRoute({
    ...secured,
    method: "get",
    path: "/api/routing",
    responses: {
      200: json(RoutingView, "Global routing, and each project's own and effective routing"),
    },
  }),
  putGlobal: createRoute({
    ...secured,
    method: "put",
    path: "/api/routing",
    request: { body: { content: { "application/json": { schema: RoutingSave } } } },
    responses: { 200: json(RoutingConfig, "The saved global routing"), ...errors },
  }),
  putProject: createRoute({
    ...secured,
    method: "put",
    path: "/api/projects/{projectId}/routing",
    request: {
      params: z.object({ projectId: RoutingProjectId }),
      body: { content: { "application/json": { schema: RoutingSave } } },
    },
    responses: {
      200: json(RoutingConfig, "The saved project routing"),
      404: json(ErrorBody, "Unknown project"),
      ...errors,
    },
  }),
};

export function registerRoutingRoutes(
  app: OpenAPIHono<AuthEnv>,
  routing: RoutingSettings,
  listProjectIds: () => Promise<string[]>,
): void {
  app.openapi(routes.get, async (c) => {
    const [global, ids] = await Promise.all([routing.global(), listProjectIds()]);
    const projects = await Promise.all(ids.map((id) => routing.project(id)));
    return c.json({ global, projects }, 200);
  });

  app.openapi(routes.putGlobal, async (c) => {
    const { ifUpdatedAt, reason, ...fields } = c.req.valid("json");
    const { actor } = signedIn(c.get("identity"));
    return c.json(await routing.putGlobal(fields, ifUpdatedAt, actor, reason), 200);
  });

  app.openapi(routes.putProject, async (c) => {
    const { ifUpdatedAt, reason, ...fields } = c.req.valid("json");
    const { actor } = signedIn(c.get("identity"));
    const { projectId } = c.req.valid("param");
    return c.json(await routing.putProject(projectId, fields, ifUpdatedAt, actor, reason), 200);
  });
}

/** Listed in `api-routes.ts` (AI-145); absent when the routing store is not configured. */
export const apiRoutes: RouteModule = (app, s) => {
  if (!s.routing) return;
  registerRoutingRoutes(app, s.routing, async () =>
    (await s.tracker.listProjects()).map((p) => p.id),
  );
};
