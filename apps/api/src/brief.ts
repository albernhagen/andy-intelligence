import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { BriefAnswers, ProposedPullRequest } from "@andy/contracts";
import type { BriefService } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * The project brief's write and its state (AI-107, AI-373). The write (ADR-0053 "What the API
 * does"): owner-only answers in,
 * a PR on the project's repo out. The MCP tool `submit_brief` calls the same service.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

export const BriefSubmissionView = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("opened"),
    pullRequest: ProposedPullRequest,
    /** A brief existed on the default branch; the PR replaces it. */
    revised: z.boolean(),
  }),
  z.object({ status: z.literal("unchanged") }),
]);

const Prefill = z.object({
  idea: z.string().optional(),
  problem: z.string().optional(),
  users: z.string().optional(),
  business: z.string().optional(),
});
/** The setup path's read (AI-373): is the brief on the default branch; discovery's answers. */
export const BriefStatusView = z.discriminatedUnion("readable", [
  z.object({ readable: z.literal(true), onDefaultBranch: z.boolean(), prefill: Prefill }),
  z.object({ readable: z.literal(false), problem: z.string(), prefill: Prefill }),
]);

const statusRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/brief",
  request: { params: ProjectParams },
  responses: {
    200: json(
      BriefStatusView,
      "Whether the brief is on the default branch, with discovery's answers",
    ),
    403: json(ErrorBody, "Only the owner reads the brief's state"),
    404: json(ErrorBody, "No such project"),
  },
});

const submitRoute = createRoute({
  security: [{ bearer: [] }],
  method: "post",
  path: "/api/projects/{projectId}/brief",
  request: {
    params: ProjectParams,
    body: { content: { "application/json": { schema: BriefAnswers } }, required: true },
  },
  responses: {
    201: json(BriefSubmissionView, "A PR proposes the rendered brief"),
    200: json(BriefSubmissionView, "The brief on the default branch is already this; no PR"),
    400: json(ErrorBody, "Invalid answers"),
    403: json(ErrorBody, "Only the owner submits a brief"),
    404: json(ErrorBody, "No such project"),
    422: json(
      ErrorBody,
      "A section is over its word cap (details name it), or no repo with the App (GitHub not connected)",
    ),
    429: json(ErrorBody, "The hourly cap on brief PRs is reached"),
  },
});

export function registerBriefRoutes(app: OpenAPIHono<AuthEnv>, brief: BriefService): void {
  app.openapi(statusRoute, async (c) =>
    c.json(await brief.status(c.req.valid("param").projectId, actorOf(c.get("identity"))), 200),
  );
  app.openapi(submitRoute, async (c) => {
    const result = await brief.submit(
      c.req.valid("param").projectId,
      c.req.valid("json"),
      actorOf(c.get("identity")),
    );
    return result.status === "opened" ? c.json(result, 201) : c.json(result, 200);
  });
}

/** Listed in `api-routes.ts` (AI-145). */
export const apiRoutes: RouteModule = (app, s) => registerBriefRoutes(app, s.brief);
