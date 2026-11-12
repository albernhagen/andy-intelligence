import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { IdeateSubmission, ProposedPullRequest, Question, Ticket } from "@andy/contracts";
import type { IdeateService } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";

/**
 * Ideation (AI-114, ADR-0050): an idea and the ideate procedure's result in; an epic in Ideas
 * with a spec PR, or an Ideas ticket with one question, out. Owner-only (`can`). Until AI-134
 * wires the ideate agent task, the result comes from Claude desktop (MCP `ideate`) or here.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

export const IdeateResultView = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("epic"),
    epic: Ticket,
    specPullRequest: ProposedPullRequest.nullable(),
  }),
  z.object({ outcome: z.literal("question"), ticket: Ticket, question: Question }),
]);

const ideateRoute = createRoute({
  security: [{ bearer: [] }],
  method: "post",
  path: "/api/projects/{projectId}/ideate",
  request: {
    params: ProjectParams,
    body: { content: { "application/json": { schema: IdeateSubmission } }, required: true },
  },
  responses: {
    201: json(IdeateResultView, "An epic and its spec PR, or a ticket with one question"),
    400: json(ErrorBody, "Invalid result (fields that don't fit the outcome included)"),
    403: json(ErrorBody, "Only the owner"),
    404: json(ErrorBody, "No such project"),
    422: json(ErrorBody, "No repo with the App (GitHub not connected)"),
    429: json(ErrorBody, "The hourly cap on spec PRs is reached"),
  },
});

export function registerIdeateRoutes(app: OpenAPIHono<AuthEnv>, ideate: IdeateService): void {
  app.openapi(ideateRoute, async (c) =>
    c.json(
      await ideate.submit(
        c.req.valid("param").projectId,
        c.req.valid("json"),
        actorOf(c.get("identity")),
      ),
      201,
    ),
  );
}
