import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { DIGEST_DEFAULT_HOURS, DIGEST_MAX_HOURS, Digest } from "@andy/contracts";
import { digestWindow, type DigestReader } from "@andy/domain";
import type { AuthEnv } from "./auth";

/** The daily digest's one read (AI-70, ADR-0081): computed on request, never stored. */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

/** The window's input, shared with the MCP tool: hours back from `until` (default now). */
export const DigestQuery = z.object({
  hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(DIGEST_MAX_HOURS)
    .optional()
    .describe(
      `Hours the digest covers, 1 to ${DIGEST_MAX_HOURS}. Default ${DIGEST_DEFAULT_HOURS}.`,
    ),
  until: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("End of the window (ISO date-time). Default now; a later time reads as now."),
});

const digestRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/digest",
  request: { params: ProjectParams, query: DigestQuery },
  responses: {
    200: json(Digest, "Exceptions, merged, in progress and totals for the window, plus plain text"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

export function registerDigestRoutes(
  app: OpenAPIHono<AuthEnv>,
  digest: DigestReader,
  now: () => Date,
): void {
  app.openapi(digestRoute, async (c) => {
    const { hours, until } = c.req.valid("query");
    const window = digestWindow(now(), hours, until);
    return c.json(await digest.digest(c.req.valid("param").projectId, window), 200);
  });
}
