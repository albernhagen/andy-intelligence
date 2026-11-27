import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  DEPLOYMENT_LIMITS,
  RELEASE_REQUEST_LIMITS,
  ReleaseEnvironment,
  ReleaseListing,
  ReleaseRequest,
} from "@andy/contracts";
import type { ReleaseReader, ReleaseService } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * Releases (AI-183: M6.9, ADR-0114): a project's deployments to one environment, newest first,
 * each with the tickets it shipped and its release notes. AI-199: M6.12 adds the owner's promote
 * and rollback (ADR-0160): each records a release request and starts the project's `release.yml`
 * through the same `ReleaseService` as the MCP tools. Only Andy's browser sign-in reaches `/api`,
 * and the service checks the owner again (`requireCan`).
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

/** The environment and page size, shared with the MCP tool. */
export const ReleasesQuery = z.object({
  env: ReleaseEnvironment.default("prod").describe(
    "The environment: prod (default) or dev. PR previews have no releases.",
  ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(DEPLOYMENT_LIMITS.maxPage)
    .optional()
    .describe(
      `Deployments to list, newest first: default ${DEPLOYMENT_LIMITS.defaultPage}, at most ${DEPLOYMENT_LIMITS.maxPage}.`,
    ),
});

const releasesRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/releases",
  request: { params: ProjectParams, query: ReleasesQuery },
  responses: {
    200: json(ReleaseListing, "Deployments newest first, each with its tickets and release notes"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

export function registerReleaseRoutes(app: OpenAPIHono<AuthEnv>, reader: ReleaseReader): void {
  app.openapi(releasesRoute, async (c) => {
    const { env, limit } = c.req.valid("query");
    return c.json(await reader.list(c.req.valid("param").projectId, env, limit), 200);
  });
}

const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** Promote's body, shared with the MCP tool. */
export const PromoteRequest = z
  .strictObject({
    digest: Digest.optional().describe(
      "The image digest (sha256:…) of a succeeded dev deployment; default the latest succeeded one.",
    ),
  })
  .openapi("PromoteRequest");

/** Rollback's body, shared with the MCP tool. */
export const RollbackRequest = z
  .strictObject({
    environment: ReleaseEnvironment.optional().describe("prod (default) or dev."),
    revision: z
      .string()
      .min(1)
      .max(DEPLOYMENT_LIMITS.revision)
      .optional()
      .describe(
        "The revision of an earlier succeeded deployment; default the one before what serves now.",
      ),
  })
  .openapi("RollbackRequest");

export const ReleaseRequestResult = z
  .object({
    request: ReleaseRequest,
    summary: z.string().describe("What will serve afterwards"),
  })
  .openapi("ReleaseRequestResult");

export const ReleaseRequestListing = z
  .object({ requests: z.array(ReleaseRequest) })
  .openapi("ReleaseRequestListing");

export const ReleaseRequestsQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(RELEASE_REQUEST_LIMITS.maxPage)
    .optional()
    .describe(
      `Requests to list, newest first: default ${RELEASE_REQUEST_LIMITS.defaultPage}, at most ${RELEASE_REQUEST_LIMITS.maxPage}.`,
    ),
});

const releaseResponses = {
  202: json(ReleaseRequestResult, "Recorded and release.yml started"),
  400: json(ErrorBody, "Invalid request"),
  403: json(ErrorBody, "Not the owner"),
  404: json(ErrorBody, "Not found"),
  409: json(ErrorBody, "Refused: the project can't release this (the error says why)"),
  422: json(ErrorBody, "No succeeded deployment has that digest or revision"),
  429: json(ErrorBody, "One release request per project per minute"),
  502: json(ErrorBody, "The code host refused to start release.yml; nothing changed"),
  503: json(ErrorBody, "The code host is not connected"),
};

const promoteRoute = createRoute({
  security: [{ bearer: [] }],
  method: "post",
  path: "/api/projects/{projectId}/releases/promote",
  request: {
    params: ProjectParams,
    body: { content: { "application/json": { schema: PromoteRequest } } },
  },
  responses: releaseResponses,
});

const rollbackRoute = createRoute({
  security: [{ bearer: [] }],
  method: "post",
  path: "/api/projects/{projectId}/releases/rollback",
  request: {
    params: ProjectParams,
    body: { content: { "application/json": { schema: RollbackRequest } } },
  },
  responses: releaseResponses,
});

const requestsRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/releases/requests",
  request: { params: ProjectParams, query: ReleaseRequestsQuery },
  responses: {
    200: json(ReleaseRequestListing, "Promote and rollback requests, newest first"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

export function registerReleaseRequestRoutes(
  app: OpenAPIHono<AuthEnv>,
  service: ReleaseService,
): void {
  app.openapi(promoteRoute, async (c) => {
    const { digest } = c.req.valid("json");
    const projectId = c.req.valid("param").projectId;
    const result = await service.promote(
      { projectId, ...(digest ? { digest } : {}) },
      actorOf(c.get("identity")),
    );
    return c.json(result, 202);
  });
  app.openapi(rollbackRoute, async (c) => {
    const { environment, revision } = c.req.valid("json");
    const projectId = c.req.valid("param").projectId;
    const result = await service.rollback(
      {
        projectId,
        ...(environment ? { environment } : {}),
        ...(revision ? { revision } : {}),
      },
      actorOf(c.get("identity")),
    );
    return c.json(result, 202);
  });
  app.openapi(requestsRoute, async (c) => {
    const { limit } = c.req.valid("query");
    const requests = await service.list(c.req.valid("param").projectId, limit);
    return c.json({ requests }, 200);
  });
}

/** Listed in `api-routes.ts` (AI-145); absent without their stores. */
export const apiRoutes: RouteModule = (app, s) => {
  if (s.releases) registerReleaseRoutes(app, s.releases);
  if (s.releaseRequests) registerReleaseRequestRoutes(app, s.releaseRequests);
};
