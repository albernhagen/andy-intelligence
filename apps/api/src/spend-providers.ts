import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { ProviderSpendTotals } from "@andy/contracts";
import type { AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * Paid spend by provider (AI-257: M10.9), under /api (Firebase sign-in + allow-list; the project
 * in the path is checked by `project-access.ts`). Read-only: the spend ledger's per-provider
 * totals (AI-280) for the project and for all projects, today and this month. Null when the
 * ledger can't be read (unknown, never zero). The read is `SpendSettingsService.byProvider`,
 * shared with MCP `get_spend` (AI-288). Nothing here spends money.
 */

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
  // AI-288: the same read as MCP `get_spend`'s `byProvider`.
  app.openapi(route, async (c) =>
    c.json(await s.spend.byProvider(c.req.valid("param").projectId), 200),
  );
};
