import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { BoardTicket } from "@andy/contracts";
import { WORK_VIEWS, type WorkReader } from "@andy/domain";
import type { AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * Work across projects (AI-198, ADR-0108): one fixed view's open tickets, grouped by project.
 * Read-only; reads each project's board through the read cache (ADR-0126), first 50 projects
 * by key, at most 200 tickets (ADR-0028).
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

export const WorkViewName = z.enum(WORK_VIEWS);
const WorkQuery = z.object({
  view: WorkViewName,
  project: z
    .string()
    .regex(/^[a-z][a-z0-9]{0,9}$/)
    .optional(),
});
const Count = z.number().int().nonnegative();
export const WorkListBody = z.object({
  view: WorkViewName,
  counts: z.object({
    "needs-me": Count,
    mine: Count,
    agents: Count,
    blocked: Count,
    "in-review": Count,
  }),
  /** The Needs-you chip: the header's tickets for the same projects, and its named parts (AI-347). */
  needsYou: z.object({ tickets: Count, stale: Count, toPickWorker: Count }),
  projects: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      count: z.number().int().nonnegative(),
      tickets: z.array(BoardTicket.extend({ blockers: z.array(z.string()) })),
    }),
  ),
  truncated: z.boolean(),
});

const workRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/work",
  request: { query: WorkQuery },
  responses: {
    200: json(WorkListBody, "Open tickets in the view, grouped by project"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

export function registerWorkRoutes(app: OpenAPIHono<AuthEnv>, work: WorkReader): void {
  app.openapi(workRoute, async (c) => {
    const { view, project } = c.req.valid("query");
    return c.json(await work.list(view, project), 200);
  });
}

/** Listed in `api-routes.ts` (AI-145). */
export const apiRoutes: RouteModule = (app, s) => registerWorkRoutes(app, s.work);
