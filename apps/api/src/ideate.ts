import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  IdeateSubmission,
  IdeateTaskRequest,
  ProposedPullRequest,
  Question,
  Run,
  Ticket,
} from "@andy/contracts";
import type { IdeateService, RunService } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";

/**
 * Ideation (AI-114, ADR-0050): an idea and the ideate procedure's result in; an epic in Ideas
 * with a spec PR, or an Ideas ticket with one question, out. Owner-only (`can`). The result
 * comes from an ideate agent task (AI-134, `POST .../ideate/agent-task` with the idea), from
 * Claude desktop (MCP `ideate`), or here.
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
    409: json(ErrorBody, "The spec file already exists: pick another slug"),
    422: json(ErrorBody, "No repo with the App (GitHub not connected)"),
    429: json(ErrorBody, "The hourly cap on ideas is reached"),
  },
});

const ideateTaskRoute = createRoute({
  security: [{ bearer: [] }],
  method: "post",
  path: "/api/projects/{projectId}/ideate/agent-task",
  request: {
    params: ProjectParams,
    body: { content: { "application/json": { schema: IdeateTaskRequest } }, required: true },
  },
  responses: {
    201: json(Run, "An ideate agent task started on the idea"),
    400: json(ErrorBody, "Invalid idea"),
    403: json(ErrorBody, "Only the owner"),
    404: json(ErrorBody, "No such project"),
    409: json(ErrorBody, "An ideate task is in flight, or the agent-task caps are reached"),
    422: json(ErrorBody, "No repo"),
    502: json(ErrorBody, "The executor couldn't start it (GitHub not connected)"),
    503: json(ErrorBody, "No executor"),
  },
});

export function registerIdeateRoutes(
  app: OpenAPIHono<AuthEnv>,
  ideate: IdeateService,
  runs: Pick<RunService, "requestProjectTask">,
): void {
  app.openapi(ideateTaskRoute, async (c) =>
    c.json(
      await runs.requestProjectTask(
        c.req.valid("param").projectId,
        "ideate",
        c.req.valid("json"),
        actorOf(c.get("identity")),
      ),
      201,
    ),
  );
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
