import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { ConfigChange, ConfigProposalSweep, type ReviewFindingSource } from "@andy/contracts";
import type { ConfigProposals } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";

/**
 * Pending config changes from repeated review findings (ADR-0097), under /api (Firebase sign-in
 * + allow-list), the same rules as the MCP tools and the UI. Andy sweeps a project on demand,
 * lists what is pending, and accepts or rejects. Accepting records agreement only: applying the
 * text is M4 config editing. Nothing here applies a change.
 */

/**
 * Until findings are stored (PR B of ADR-0097: a callback from the review workflow), the source
 * has none, so a sweep proposes nothing.
 */
export const noReviewFindings: ReviewFindingSource = { recent: async () => [] };

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const secured = { security: [{ bearer: [] }] };
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });
const ChangeParams = z.object({ changeId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) });
const ListQuery = z.object({
  projectId: z
    .string()
    .regex(/^[a-z][a-z0-9]{0,9}$/)
    .optional(),
});

const decideRoute = (decision: "accept" | "reject") =>
  createRoute({
    ...secured,
    method: "post",
    path: `/api/config-changes/{changeId}/${decision}`,
    request: { params: ChangeParams },
    responses: {
      200: json(ConfigChange, decision === "accept" ? "Accepted; nothing is applied" : "Rejected"),
      403: json(ErrorBody, "Only the owner decides config changes"),
      409: json(ErrorBody, "Not pending"),
      422: json(ErrorBody, "Unknown config change"),
    },
  });

const routes = {
  list: createRoute({
    ...secured,
    method: "get",
    path: "/api/config-changes",
    request: { query: ListQuery },
    responses: {
      200: json(
        z.array(ConfigChange),
        "Every pending config change (of one project), newest first",
      ),
      422: json(ErrorBody, "Unknown project"),
    },
  }),
  sweep: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/config-proposals/sweep",
    request: { params: ProjectParams },
    responses: {
      200: json(
        ConfigProposalSweep,
        "Pending proposals written or already pending (none applied); throttled within a minute",
      ),
      422: json(ErrorBody, "Unknown project"),
    },
  }),
  accept: decideRoute("accept"),
  reject: decideRoute("reject"),
};

export function registerConfigProposalRoutes(
  app: OpenAPIHono<AuthEnv>,
  proposals: ConfigProposals,
): void {
  app.openapi(routes.list, async (c) =>
    c.json(await proposals.listPending(c.req.valid("query").projectId), 200),
  );

  app.openapi(routes.sweep, async (c) =>
    c.json(await proposals.sweep(c.req.valid("param").projectId), 200),
  );

  app.openapi(routes.accept, async (c) => {
    const { changeId } = c.req.valid("param");
    return c.json(await proposals.decide(changeId, "accepted", actorOf(c.get("identity"))), 200);
  });

  app.openapi(routes.reject, async (c) => {
    const { changeId } = c.req.valid("param");
    return c.json(await proposals.decide(changeId, "rejected", actorOf(c.get("identity"))), 200);
  });
}
