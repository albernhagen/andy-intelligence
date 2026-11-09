import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { QuotaStatus, type QuotaStore } from "@andy/contracts";
import { quotaStatus } from "@andy/domain";
import type { AuthEnv } from "./auth";

const route = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/quota",
  responses: {
    200: {
      content: { "application/json": { schema: QuotaStatus } },
      description: "Claude subscription quota: latest reading per window, with freshness and level",
    },
  },
});

/** The gauge and banner's data (§5). A null store reads as unknown, e.g. in local dev. */
export function registerQuotaRoutes(
  app: OpenAPIHono<AuthEnv>,
  quota: QuotaStore | null,
  now: () => Date,
): void {
  app.openapi(route, async (c) => {
    const readings = quota ? await quota.latest("claude-sub") : [];
    return c.json(quotaStatus("claude-sub", readings, now()), 200);
  });
}
