import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { WHATS_NEW_DEFAULT_DAYS, WHATS_NEW_MAX_DAYS, WhatsNew } from "@andy/contracts";
import { whatsNewWindow, type WhatsNewReader } from "@andy/domain";
import type { AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/** What's new (AI-159, ADR-0121): status per milestone epic, then merged changes. Read-only. */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

/** The window and filter, shared with the MCP tool. */
export const WhatsNewQuery = z.object({
  since: z.iso
    .datetime({ offset: true })
    .optional()
    .describe(
      `Start of the window (ISO date-time). Default ${WHATS_NEW_DEFAULT_DAYS} days before \`until\`; at most ${WHATS_NEW_MAX_DAYS} days back.`,
    ),
  until: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("End of the window (ISO date-time). Default now; a later time reads as now."),
  epic: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{0,9}-\d+$/)
    .optional()
    .describe('Only changes under this milestone epic, by key, e.g. "AI-84".'),
});

const whatsNewRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/whats-new",
  request: { params: ProjectParams, query: WhatsNewQuery },
  responses: {
    200: json(WhatsNew, "Status per milestone epic, what needs Andy, then merged changes"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

export function registerWhatsNewRoutes(
  app: OpenAPIHono<AuthEnv>,
  reader: WhatsNewReader,
  now: () => Date,
): void {
  app.openapi(whatsNewRoute, async (c) => {
    const { since, until, epic } = c.req.valid("query");
    const window = whatsNewWindow(now(), since, until);
    return c.json(await reader.read(c.req.valid("param").projectId, window, epic), 200);
  });
}

/** Listed in `api-routes.ts` (AI-145); absent without a release-note store. */
export const apiRoutes: RouteModule = (app, s) => {
  if (s.whatsNew) registerWhatsNewRoutes(app, s.whatsNew, s.now);
};
