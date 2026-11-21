import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { ProviderSpendTotals, notFound } from "@andy/contracts";
import type { AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * Paid spend by provider (AI-257: M10.9), under /api (Firebase sign-in + allow-list; the project
 * in the path is checked by `project-access.ts`). Read-only: the spend ledger's per-provider
 * totals (AI-280) for the project and for all projects, today and this month. Null when the
 * ledger can't be read (unknown, never zero). Nothing here spends money.
 */

function log(severity: "WARNING", message: string, fields: object) {
  console.log(JSON.stringify({ severity, message, component: "spend-providers", ...fields }));
}

const ErrorBody = z.object({ error: z.string() });
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

export const SpendByProvider = z
  .object({
    project: z.array(ProviderSpendTotals).nullable(),
    global: z.array(ProviderSpendTotals).nullable(),
  })
  .openapi("SpendByProvider");

const route = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/spend/providers",
  request: { params: ProjectParams },
  responses: {
    200: {
      content: { "application/json": { schema: SpendByProvider } },
      description: "Spend per provider today and this month, for the project and all projects",
    },
    404: { content: { "application/json": { schema: ErrorBody } }, description: "Unknown project" },
  },
});

export const apiRoutes: RouteModule = (app: OpenAPIHono<AuthEnv>, s) => {
  app.openapi(route, async (c) => {
    const { projectId } = c.req.valid("param");
    if (!(await s.deps.tracker.getProject(projectId))) throw notFound("project", projectId);
    const ledger = s.deps.spendLedger;
    if (!ledger) return c.json({ project: null, global: null }, 200);
    const at = s.now().toISOString();
    try {
      const [project, global] = await Promise.all([
        ledger.totalsByProvider({ projectId }, at),
        ledger.totalsByProvider({}, at),
      ]);
      return c.json({ project, global }, 200);
    } catch (err) {
      log("WARNING", "spend by provider unreadable", { projectId, error: String(err) });
      return c.json({ project: null, global: null }, 200);
    }
  });
};
