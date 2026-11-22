import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  DIGEST_DEFAULT_HOURS,
  DIGEST_MAX_HOURS,
  Digest,
  DigestSummaryView,
  type EventActor,
} from "@andy/contracts";
import {
  digestWindow,
  latestFinishedDay,
  withDigestSummary,
  type DigestReader,
  type DigestSummaryService,
  type DigestWindow,
} from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * The daily digest's one read (AI-70, ADR-0081): computed on request, never stored. On top, the
 * latest finished day's model-written summary (AI-323, ADR-0137), stored once a day.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

/** The window's input, shared with the MCP tool: hours back from `until` (default now). */
export const DigestQuery = z.object({
  hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(DIGEST_MAX_HOURS)
    .optional()
    .describe(
      `Hours the digest covers, 1 to ${DIGEST_MAX_HOURS}. Default ${DIGEST_DEFAULT_HOURS}.`,
    ),
  until: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("End of the window (ISO date-time). Default now; a later time reads as now."),
});

function log(severity: "ERROR", message: string, fields: object) {
  console.log(JSON.stringify({ severity, message, component: "digest", ...fields }));
}

/**
 * The digest with the summary on top, for the page and MCP `digest` alike. A summary that can't
 * be read never fails the digest: it shows the list and says why (fail closed).
 */
export async function digestWithSummary(
  reader: DigestReader,
  summaries: DigestSummaryService | null,
  projectId: string,
  window: DigestWindow,
  actor: EventActor,
  now: Date,
): Promise<Digest> {
  const digest = await reader.digest(projectId, window);
  if (!summaries) return digest;
  try {
    return withDigestSummary(digest, await summaries.forDigest(projectId, actor));
  } catch (err) {
    log("ERROR", "digest summary unreadable", { projectId, error: String(err) });
    const day = latestFinishedDay(now);
    return withDigestSummary(digest, {
      day: day.id,
      timeZone: day.timeZone,
      state: "failed",
      output: null,
      reason: "the summary couldn't be read",
      model: null,
      writtenAt: null,
      canRetry: false,
    });
  }
}

const digestRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/digest",
  request: { params: ProjectParams, query: DigestQuery },
  responses: {
    200: json(
      Digest,
      "The latest day's summary, then exceptions, merged, in progress and totals, plus plain text",
    ),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

const retryRoute = createRoute({
  security: [{ bearer: [] }],
  method: "post",
  path: "/api/projects/{projectId}/digest/summary/retry",
  request: { params: ProjectParams },
  responses: {
    200: json(DigestSummaryView, "The retried summary: writing, waiting, or failed again"),
    403: json(ErrorBody, "Only Andy can retry it"),
    409: json(ErrorBody, "Not failed, its retry used, or the day's cap reached"),
    503: json(ErrorBody, "Summaries aren't wired on this instance"),
  },
});

export function registerDigestRoutes(
  app: OpenAPIHono<AuthEnv>,
  digest: DigestReader,
  summaries: DigestSummaryService | null,
  now: () => Date,
): void {
  app.openapi(digestRoute, async (c) => {
    const { hours, until } = c.req.valid("query");
    const at = now();
    const window = digestWindow(at, hours, until);
    const projectId = c.req.valid("param").projectId;
    const actor = actorOf(c.get("identity"));
    return c.json(await digestWithSummary(digest, summaries, projectId, window, actor, at), 200);
  });
  app.openapi(retryRoute, async (c) => {
    if (!summaries) return c.json({ error: "digest summaries aren't wired" }, 503);
    const projectId = c.req.valid("param").projectId;
    return c.json(await summaries.retry(projectId, actorOf(c.get("identity"))), 200);
  });
}

/** Listed in `api-routes.ts` (AI-145). */
export const apiRoutes: RouteModule = (app, s) =>
  registerDigestRoutes(app, s.digest, s.digestSummaries ?? null, s.now);
