import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  DASHBOARD_DEFAULT_WEEKS,
  DASHBOARD_MAX_WEEKS,
  Dashboard,
  ProjectDashboard,
  type RunStore,
  type WorkTracker,
} from "@andy/contracts";
import { DashboardReader, dashboardWindow } from "@andy/domain";
import type { AuthEnv } from "./auth";

/** The Dashboards data reads (AI-102, ADR-0045): computed on request, never stored. */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

export const DashboardQuery = z.object({
  weeks: z.coerce
    .number()
    .int()
    .min(1)
    .max(DASHBOARD_MAX_WEEKS)
    .optional()
    .describe(
      `UTC weeks covered, Monday first, the last ending now: 1 to ${DASHBOARD_MAX_WEEKS}. Default ${DASHBOARD_DEFAULT_WEEKS}.`,
    ),
});

const projectRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/dashboard",
  request: { params: ProjectParams, query: DashboardQuery },
  responses: {
    200: json(ProjectDashboard, "Delivery and cost per week, the costliest agent tasks"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

const allRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/dashboard",
  request: { query: DashboardQuery },
  responses: {
    200: json(Dashboard, "The same figures summed across projects, then per project"),
    400: json(ErrorBody, "Invalid request"),
  },
});

export function registerDashboardRoutes(
  app: OpenAPIHono<AuthEnv>,
  deps: { tracker: WorkTracker; runs: RunStore },
  now: () => Date,
): void {
  const reader = new DashboardReader(deps.tracker, deps.runs);
  app.openapi(projectRoute, async (c) => {
    const window = dashboardWindow(now(), c.req.valid("query").weeks);
    return c.json(await reader.project(c.req.valid("param").projectId, window), 200);
  });
  app.openapi(allRoute, async (c) => {
    const window = dashboardWindow(now(), c.req.valid("query").weeks);
    return c.json(await reader.all(window), 200);
  });
}
