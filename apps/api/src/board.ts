import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { BoardTicket } from "@andy/contracts";
import type { BoardReader } from "@andy/domain";
import type { AuthEnv } from "./auth";

/** The board's one read (AI-28: Board v2): tickets by rank, each with what its card shows. */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

const boardRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/board",
  request: { params: ProjectParams },
  responses: {
    200: json(z.array(BoardTicket), "Tickets by rank, archived included, with card status"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

export function registerBoardRoutes(app: OpenAPIHono<AuthEnv>, board: BoardReader): void {
  app.openapi(boardRoute, async (c) =>
    c.json(await board.tickets(c.req.valid("param").projectId), 200),
  );
}
