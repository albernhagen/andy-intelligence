import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { QuotaClearResult, QuotaStatus, type QuotaStore } from "@andy/contracts";
import { quotaStatus, type QuotaClearer } from "@andy/domain";
import { signedIn, type AuthEnv } from "./auth";

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });

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

const clearRoute = createRoute({
  security: [{ bearer: [] }],
  method: "post",
  path: "/api/quota/clear",
  responses: {
    200: {
      content: { "application/json": { schema: QuotaClearResult } },
      description: "The readings that held dispatch at the reserve, now discarded",
    },
    409: {
      content: { "application/json": { schema: ErrorBody } },
      description: "No reading holds dispatch at the reserve, or it was already cleared",
    },
  },
});

/**
 * The gauge and banner's data (§5), and Andy's clear of a quota idle (AI-74; owner only, like
 * the other setters: every /api caller is on the allow-list). A null store reads as unknown.
 */
export function registerQuotaRoutes(
  app: OpenAPIHono<AuthEnv>,
  quota: QuotaStore | null,
  clearer: QuotaClearer,
  now: () => Date,
): void {
  app.openapi(route, async (c) => {
    const readings = quota ? await quota.latest("claude-sub") : [];
    return c.json(quotaStatus("claude-sub", readings, now()), 200);
  });

  // A refusal is a DomainError `not_clearable`, mapped to 409 by the app's error handler.
  app.openapi(clearRoute, async (c) =>
    c.json(await clearer.clearIdle(signedIn(c.get("identity"))), 200),
  );
}
