import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { Size, Stage, TicketType, type RunStore, type WorkTracker } from "@andy/contracts";
import { readEpicRollup, type EpicRollup as EpicRollupValue } from "@andy/domain";
import type { AuthEnv } from "./auth";

/** An epic's children and roll-up (AI-85), computed on read. Read-only, signed-in. */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const TicketParams = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
  ticketId: z.uuid(),
});

export const EpicRollup = z
  .object({
    children: z.array(
      z.object({
        id: z.string(),
        key: z.string(),
        title: z.string(),
        type: TicketType.nullable(),
        stage: Stage,
        size: Size.nullable(),
        openBlockers: z.array(z.string()),
      }),
    ),
    progress: z.object({ done: z.number().int(), total: z.number().int() }),
    cost: z.object({
      estimatedCostUsd: z.number(),
      completedRuns: z.number().int(),
      unknownRuns: z.number().int(),
    }),
    costedChildren: z.number().int(),
    partial: z.boolean(),
  })
  .openapi("EpicRollup") satisfies z.ZodType<EpicRollupValue>;

const epicRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/tickets/{ticketId}/epic",
  request: { params: TicketParams },
  responses: {
    200: json(EpicRollup, "The epic's children in dependency order, progress and cost"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
    422: json(ErrorBody, "The ticket isn't an epic"),
  },
});

export function registerEpicRoutes(
  app: OpenAPIHono<AuthEnv>,
  tracker: WorkTracker,
  runs: RunStore,
): void {
  app.openapi(epicRoute, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const epic = await tracker.getTicket(projectId, ticketId);
    if (!epic) return c.json({ error: "ticket not found" }, 404);
    const tickets = await tracker.listTickets(projectId);
    const rollup = await readEpicRollup(epic, tickets, (p, t) => runs.listForTicket(p, t));
    return c.json(rollup, 200);
  });
}
