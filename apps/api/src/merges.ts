import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { MergeMode, MergeWaitReason } from "@andy/contracts";
import { actorOf, type AuthEnv } from "./auth";
import { MERGE_PR_HOURLY_CAP, type PullRequestMerger } from "./merge";
import type { RouteModule } from "./services";

/**
 * Merge from the web app (AI-388, ADR-0157): Andy's Merge button puts a PR in its repo's merge
 * queue through the same service as MCP `merge_pr`, with his click as the owner's approval. Only
 * Andy's browser sign-in reaches `/api` (the MCP grant doesn't), and the service checks the owner
 * again (`requireCan`). The approval waives only what the merge mode keeps for him; anything not
 * clean still waits, with every reason.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

export const MergeRequest = z
  .strictObject({
    repo: z.string().trim().min(3).max(200),
    number: z.number().int().positive().max(1_000_000_000),
  })
  .openapi("MergeRequest");

export const MergeResult = z
  .object({
    repo: z.string(),
    number: z.number().int(),
    url: z.string(),
    headSha: z.string(),
    ticket: z.string().nullable(),
    mode: MergeMode.nullable(),
    verdict: z.enum(["merge", "wait"]),
    reasons: z.array(MergeWaitReason),
    gateReasons: z.array(z.string()),
    keptFiles: z.array(z.string()),
    highRiskFiles: z.array(z.string()),
    merged: z.boolean(),
    mergeSha: z.string().nullable(),
    mergeError: z.string().optional(),
    queued: z.boolean(),
    queuePosition: z.number().int().nullable(),
    queueNote: z.string().nullable(),
  })
  .openapi("MergeResult");

const merge = createRoute({
  security: [{ bearer: [] }],
  method: "post",
  path: "/api/projects/{projectId}/merges",
  request: {
    params: ProjectParams,
    body: { content: { "application/json": { schema: MergeRequest } }, required: true },
  },
  responses: {
    200: json(MergeResult, "Merged, queued with its place, or waiting with every reason"),
    403: json(ErrorBody, "Only the owner merges"),
    404: json(ErrorBody, "Unknown project or pull request"),
    422: json(ErrorBody, "Not a repo of the project, not open, or its diff can't be pinned"),
    429: json(ErrorBody, `Past ${MERGE_PR_HOURLY_CAP} merges per project per hour`),
    503: json(ErrorBody, "GitHub is not connected"),
  },
});

export function registerMergeRoutes(app: OpenAPIHono<AuthEnv>, merges: PullRequestMerger): void {
  app.openapi(merge, async (c) => {
    const { projectId } = c.req.valid("param");
    const { repo, number } = c.req.valid("json");
    const result = await merges.merge({ projectId, repo, number }, actorOf(c.get("identity")), {
      ownerApproval: true,
    });
    return c.json(result, 200);
  });
}

/** Listed in `api-routes.ts` (AI-145). Absent without the merge service. */
export const apiRoutes: RouteModule = (app, s) => {
  if (s.merges) registerMergeRoutes(app, s.merges);
};
