import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { Run, type RunExecutor } from "@andy/contracts";
import { STARTABLE_STEPS, type RunService } from "@andy/domain";
import { bodyLimit } from "hono/body-limit";
import type { AuthEnv } from "./auth";
import { FixedWindowLimiter } from "./mcp/rate-limit";
import type { ActionsTokenVerifier } from "./github/token";

/**
 * Agent runs (M1.6a: Claude Code executor). Andy starts and lists runs under /api. The run
 * itself calls back outside /api (§9 agent callback auth): it presents its Actions OIDC token,
 * and the claims must match the repo, platform workflow and workflow run it was dispatched as.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const ok = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const TicketParams = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
  ticketId: z.uuid(),
});
const StartRun = z.object({ step: z.enum(STARTABLE_STEPS) });
const secured = { security: [{ bearer: [] }] };

const routes = {
  listRuns: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}/tickets/{ticketId}/runs",
    request: { params: TicketParams },
    responses: { 200: ok(z.array(Run), "Runs, newest first"), 404: ok(ErrorBody, "Not found") },
  }),
  startRun: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/tickets/{ticketId}/runs",
    request: {
      params: TicketParams,
      body: { content: { "application/json": { schema: StartRun } }, required: true },
    },
    responses: {
      201: ok(Run, "Dispatched"),
      400: ok(ErrorBody, "Invalid request"),
      404: ok(ErrorBody, "Not found"),
      409: ok(ErrorBody, "A run is already in flight"),
      422: ok(ErrorBody, "Rule violation"),
      502: ok(ErrorBody, "The executor refused the run"),
      503: ok(ErrorBody, "No executor (GitHub not connected)"),
    },
  }),
};

export function registerRunRoutes(app: OpenAPIHono<AuthEnv>, runs: RunService): void {
  app.openapi(routes.listRuns, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(await runs.list(projectId, ticketId), 200);
  });

  app.openapi(routes.startRun, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(await runs.start(projectId, ticketId, c.req.valid("json").step), 201);
  });
}

// ── Callbacks from the run ───────────────────────────────────────────────────

export const RUN_CONTEXT_PATH = "/runs/:runId/context";
export const RUN_REPORT_PATH = "/runs/:runId/report";
/** Verified callbacks per instance per minute (max 2 instances; ADR-0028). */
export const RUN_CALLBACK_RATE_LIMIT = 60;
/** Report body cap: a 20,000-character summary plus a little JSON. */
export const RUN_REPORT_MAX_BYTES = 96 * 1024;

const RunId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

const Report = z.object({
  status: z.enum(["succeeded", "failed"]),
  summary: z.string().nullable(),
  tokensIn: z.number().int().nonnegative().nullable(),
  tokensOut: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
});

function log(severity: "INFO" | "WARNING", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "run-callback", ...fields }));
}

export interface RunCallbackDeps {
  runs: RunService;
  verify: ActionsTokenVerifier;
  now?: () => Date;
}

export function registerRunCallbacks(app: OpenAPIHono<AuthEnv>, deps: RunCallbackDeps): void {
  const now = deps.now ?? (() => new Date());
  const limiter = new FixedWindowLimiter(RUN_CALLBACK_RATE_LIMIT, 60_000, () => now().getTime());

  /** The verified caller, or null (the caller answers 401). */
  const authenticate = async (authorization: string | undefined): Promise<RunExecutor | null> => {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
    try {
      if (!match?.[1]) throw new Error("no bearer token");
      const claims = await deps.verify(match[1]);
      if (!claims.job_workflow_ref || !claims.run_id) throw new Error("not an Actions job token");
      return { repo: claims.repository, ref: claims.job_workflow_ref, externalId: claims.run_id };
    } catch {
      log("WARNING", "run callback token rejected");
      return null;
    }
  };

  app.get(RUN_CONTEXT_PATH, async (c) => {
    const runId = RunId.safeParse(c.req.param("runId"));
    if (!runId.success) return c.json({ error: "not found" }, 404);
    const caller = await authenticate(c.req.header("authorization"));
    if (!caller) return c.json({ error: "unauthenticated" }, 401);
    // After verification, so unauthenticated floods can't use up the cap.
    if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);
    const context = await deps.runs.context(runId.data, caller);
    log("INFO", "run context served", { runId: runId.data, externalId: caller.externalId });
    return c.json(context, 200);
  });

  app.post(
    RUN_REPORT_PATH,
    bodyLimit({
      maxSize: RUN_REPORT_MAX_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
    }),
    async (c) => {
      const runId = RunId.safeParse(c.req.param("runId"));
      if (!runId.success) return c.json({ error: "not found" }, 404);
      const caller = await authenticate(c.req.header("authorization"));
      if (!caller) return c.json({ error: "unauthenticated" }, 401);
      if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);
      const body = Report.safeParse(await c.req.json().catch(() => null));
      if (!body.success) {
        const details = body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        return c.json({ error: "invalid request", details }, 400);
      }
      const result = await deps.runs.report(runId.data, caller, body.data);
      return c.json({ result }, 200);
    },
  );
}
