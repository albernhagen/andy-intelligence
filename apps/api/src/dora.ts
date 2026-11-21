import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { DoraReader, type DoraReport as DoraReportValue } from "@andy/domain";
import type { AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * A project's DORA metrics (AI-200: M6.15, ADR-0040) over the last 30 and 90 days, from its
 * production deployment records. Read-only, signed-in; computed on request, never stored.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

const Distribution = z.object({
  median: z.number().nullable(),
  p90: z.number().nullable(),
  count: z.number().int(),
});

export const DoraReport = z
  .object({
    projectKey: z.string(),
    windows: z.array(
      z.object({
        days: z.union([z.literal(30), z.literal(90)]),
        from: z.string(),
        to: z.string(),
        metrics: z.object({
          deployments: z.number().int(),
          deployFrequency: z.object({ perDay: z.number(), perWeek: z.number() }),
          leadTimeHours: Distribution,
          changeFailureRate: z.number().nullable(),
          failedDeployments: z.number().int(),
          timeToRestoreHours: Distribution.extend({ open: z.number().int() }),
          ignored: z.number().int(),
        }),
      }),
    ),
    leadTimeMeasured: z.boolean(),
    latestGood: z.object({ gitSha: z.string(), finishedAt: z.string().nullable() }).nullable(),
    partial: z.boolean(),
  })
  .openapi("DoraReport") satisfies z.ZodType<DoraReportValue>;

const doraRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/dora",
  request: { params: ProjectParams },
  responses: {
    200: json(DoraReport, "Deploy frequency, lead time, change failure rate and time to restore"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

export function registerDoraRoutes(app: OpenAPIHono<AuthEnv>, reader: DoraReader): void {
  app.openapi(doraRoute, async (c) =>
    c.json(await reader.report(c.req.valid("param").projectId), 200),
  );
}

/** Listed in `api-routes.ts` (AI-145). */
export const apiRoutes: RouteModule = (app, s) =>
  registerDoraRoutes(app, new DoraReader(s.tracker, s.deps.deployments ?? null, s.now));
