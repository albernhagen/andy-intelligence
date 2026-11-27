import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { Stage, TicketKey } from "@andy/contracts";
import { MilestoneMapReader, type MilestoneMap as MilestoneMapValue } from "@andy/domain";
import type { AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/** The milestone map (AI-148): each open epic's children by state, from tickets. Read-only. */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

/** The map's input, shared with the MCP tool. */
export const MilestoneMapQuery = z.object({
  epic: TicketKey.optional().describe(
    'One epic\'s key, e.g. "AI-84", in any stage. Omit for every open epic.',
  ),
});

const MapItem = z.object({
  key: z.string(),
  title: z.string(),
  prNumber: z.number().int().nullable(),
  openBlockers: z.array(z.string()),
  needsAttention: z.boolean(),
});

export const MilestoneMap = z
  .object({
    projectKey: z.string(),
    epics: z.array(
      z.object({
        key: z.string(),
        title: z.string(),
        stage: Stage,
        state: z.enum(["not_started", "in_progress", "waiting_for_check", "done"]),
        progress: z.object({ done: z.number().int(), total: z.number().int() }),
        done: z.array(z.string()),
        inReview: z.array(MapItem),
        inProgress: z.array(MapItem),
        blocked: z.array(MapItem),
        notStarted: z.array(MapItem),
        cancelled: z.number().int(),
      }),
    ),
    unassigned: z.array(z.string()),
    truncated: z.object({ epics: z.boolean(), prNumbers: z.boolean(), unassigned: z.boolean() }),
    text: z.string(),
  })
  .openapi("MilestoneMap") satisfies z.ZodType<MilestoneMapValue>;

const mapRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/milestone-map",
  request: { params: ProjectParams, query: MilestoneMapQuery },
  responses: {
    200: json(MilestoneMap, "Each open epic's children: done, in review, in progress, blocked"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
    422: json(ErrorBody, "The key names no epic of the project"),
  },
});

export function registerMilestoneMapRoutes(
  app: OpenAPIHono<AuthEnv>,
  reader: MilestoneMapReader,
): void {
  app.openapi(mapRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await reader.map(projectId, c.req.valid("query").epic), 200);
  });
}

/** Listed in `api-routes.ts` (AI-145). */
export const apiRoutes: RouteModule = (app, s) =>
  registerMilestoneMapRoutes(app, new MilestoneMapReader(s.tracker, s.tickets));
