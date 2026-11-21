import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  CONFIG_CHANGE_LIST_MAX,
  ConfigChange,
  RoutingConfig,
  RoutingProjectId,
  Timestamp,
} from "@andy/contracts";
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
  /** True when more projects exist than one view reads (ROUTING_VIEW_MAX_PROJECTS). */
  truncated: z.boolean(),
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
    request: { query: z.object({ projectId: RoutingProjectId.optional() }) },
    responses: {
      200: json(
        RoutingView,
        "Global routing, and each project's own and effective routing (one project with `projectId`; at most 50)",
      ),
      404: json(ErrorBody, "Unknown project"),
    },
  }),
  putGlobal: createRoute({
    ...secured,
    method: "put",
    path: "/api/routing",
    request: { body: { content: { "application/json": { schema: RoutingSave } } } },
    responses: { 200: json(RoutingConfig, "The saved global routing"), ...errors },
  }),
  globalChanges: createRoute({
    ...secured,
    method: "get",
    path: "/api/routing/changes",
    request: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(CONFIG_CHANGE_LIST_MAX).optional(),
      }),
    },
    responses: {
      200: json(z.array(ConfigChange), "Global routing's changes, newest first (at most 100)"),
    },
  }),
  revert: createRoute({
    ...secured,
    method: "post",
    path: "/api/routing/changes/{changeId}/revert",
    request: { params: z.object({ changeId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) }) },
    responses: {
      200: json(
        z.object({ config: RoutingConfig, reverted: ConfigChange }),
        "Before values saved (logged as a new change); original marked reverted",
      ),
      403: json(ErrorBody, "Only the owner changes routing"),
      404: json(ErrorBody, "Unknown routing change"),
      409: json(ErrorBody, "Not revertible: not applied, a first save, or changed since"),
      422: json(ErrorBody, "The before values aren't valid routing any more"),
    },
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
    const { projectId } = c.req.valid("query");
    if (projectId) {
      const [global, project] = await Promise.all([routing.global(), routing.project(projectId)]);
      return c.json({ global, projects: [project], truncated: false }, 200);
    }
    // Global once, then one config read per project, capped (ADR-0028).
    return c.json(await routing.overview(await listProjectIds()), 200);
  });

  app.openapi(routes.putGlobal, async (c) => {
    const { ifUpdatedAt, reason, ...fields } = c.req.valid("json");
    const { actor } = signedIn(c.get("identity"));
    return c.json(await routing.putGlobal(fields, ifUpdatedAt, actor, reason), 200);
  });

  app.openapi(routes.globalChanges, async (c) =>
    c.json(await routing.globalChanges(c.req.valid("query").limit), 200),
  );

  // Global and project routing changes alike (a project's also revert from its settings log).
  app.openapi(routes.revert, async (c) => {
    const { actor } = signedIn(c.get("identity"));
    return c.json(await routing.revert(c.req.valid("param").changeId, actor), 200);
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
