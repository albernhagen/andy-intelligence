import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  PLAN_REASON_MAX,
  Run,
  RunUsage,
  RUN_REPORT_MAX_BYTES,
  RunReportRequest,
  RunHeartbeatRequest,
  type QuotaDelta,
  type QuotaReading,
  type QuotaStore,
  type RunExecutor,
} from "@andy/contracts";
import {
  STARTABLE_STEPS,
  parseRateLimits,
  quotaDelta,
  quotaRejection,
  type ParsedRateLimits,
  type RunCaller,
  type RunnerService,
  type RunService,
} from "@andy/domain";
import { bodyLimit } from "hono/body-limit";
import { actorOf, signedIn, type AuthEnv } from "./auth";
import { FixedWindowLimiter } from "./mcp/rate-limit";
import type { ActionsTokenVerifier } from "./github/token";
import { KnownCredentials } from "./known-credentials";
import { KNOWN_CREDENTIALS, RUN_TOKEN_SHAPE } from "./runners";

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
const PlanRunParams = TicketParams.extend({ runId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) });
const PlanDecisionBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  /** Required to reject: the next plan run sees it. */
  reason: z.string().max(PLAN_REASON_MAX).nullable().optional(),
});
const PlanDecisionResult = z.object({
  run: Run,
  /** The build the approval started; null when it couldn't start now (see buildError). */
  build: Run.nullable(),
  buildError: z.string().nullable(),
});
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
  decidePlan: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/tickets/{ticketId}/runs/{runId}/plan-decision",
    request: {
      params: PlanRunParams,
      body: { content: { "application/json": { schema: PlanDecisionBody } }, required: true },
    },
    responses: {
      200: ok(PlanDecisionResult, "Decided; on approval, the build started if it could"),
      400: ok(ErrorBody, "Invalid request"),
      403: ok(ErrorBody, "Only the owner decides plans"),
      404: ok(ErrorBody, "Not found"),
      409: ok(ErrorBody, "Not the latest plan, already decided, stale, or no reason"),
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
    const { step } = c.req.valid("json");
    return c.json(await runs.request(projectId, ticketId, step, actorOf(c.get("identity"))), 201);
  });

  // Owner-only (ADR-0050, AI-19): the actor is the signed-in user and the decision records the
  // email; RunService refuses any actor the policy doesn't allow.
  app.openapi(routes.decidePlan, async (c) => {
    const { projectId, ticketId, runId } = c.req.valid("param");
    const result = await runs.decidePlan(
      projectId,
      ticketId,
      runId,
      c.req.valid("json"),
      signedIn(c.get("identity")),
    );
    return c.json(result, 200);
  });
}

// ── Callbacks from the run ───────────────────────────────────────────────────

export const RUN_CONTEXT_PATH = "/runs/:runId/context";
export const RUN_REPORT_PATH = "/runs/:runId/report";
/** A local runner's heartbeat with its per-run token (ADR-0089). */
export const RUN_HEARTBEAT_PATH = "/runs/:runId/heartbeat";
/** Verified callbacks per instance per minute (max 2 instances; ADR-0028). */
export const RUN_CALLBACK_RATE_LIMIT = 60;
/**
 * Lookups of per-run tokens not seen to verify recently, per instance per minute (ADR-0094): a
 * flood of well-shaped fake tokens is capped before it reaches the store.
 */
export const RUN_TOKEN_LOOKUPS_PER_MINUTE = 60;
export { RUN_REPORT_MAX_BYTES };
const RunId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

/** Who called back, for logs: the runner's id or the workflow run's id. */
const callerLabel = (caller: RunCaller) =>
  "runnerId" in caller ? `runner:${caller.runnerId}` : `actions:${caller.externalId}`;

function log(
  severity: "INFO" | "WARNING" | "ERROR",
  message: string,
  fields: Record<string, unknown> = {},
) {
  console.log(JSON.stringify({ severity, message, component: "run-callback", ...fields }));
}

export interface RunCallbackDeps {
  runs: RunService;
  verify: ActionsTokenVerifier;
  /** Local runners (ADR-0089): per-run tokens are accepted only when set. */
  runners?: RunnerService | null;
  now?: () => Date;
  quota?: QuotaStore;
}

export function registerRunCallbacks(app: OpenAPIHono<AuthEnv>, deps: RunCallbackDeps): void {
  const now = deps.now ?? (() => new Date());
  const limiter = new FixedWindowLimiter(RUN_CALLBACK_RATE_LIMIT, 60_000, () => now().getTime());
  const tokenLookups = new FixedWindowLimiter(RUN_TOKEN_LOOKUPS_PER_MINUTE, 60_000, () =>
    now().getTime(),
  );
  const knownTokens = new KnownCredentials(
    KNOWN_CREDENTIALS.maxEntries,
    KNOWN_CREDENTIALS.ttlMs,
    () => now().getTime(),
  );

  /**
   * The verified caller, null (401), or "limited" (429): a local runner's per-run token for this
   * run (ADR-0089), else the cloud executor's Actions OIDC token. A per-run token not seen to
   * verify recently takes a lookup from a capped budget first (ADR-0094).
   */
  const authenticate = async (
    authorization: string | undefined,
    runId: string,
  ): Promise<RunCaller | null | "limited"> => {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
    if (match?.[1] && RUN_TOKEN_SHAPE.test(match[1])) {
      const token = match[1];
      if (!deps.runners) return null;
      if (!knownTokens.has(token) && !tokenLookups.tryTake()) return "limited";
      const local = await deps.runners.authenticateRun(token, runId);
      if (!local) log("WARNING", "per-run token rejected", { runId });
      else knownTokens.remember(token);
      return local;
    }
    try {
      if (!match?.[1]) throw new Error("no bearer token");
      const claims = await deps.verify(match[1]);
      if (!claims.job_workflow_ref || !claims.run_id) throw new Error("not an Actions job token");
      const executor: RunExecutor = {
        repo: claims.repository,
        ref: claims.job_workflow_ref,
        externalId: claims.run_id,
      };
      return executor;
    } catch {
      log("WARNING", "run callback token rejected");
      return null;
    }
  };

  /** Best effort: the run is already recorded, and a lost reading only leaves the gauge unknown. */
  const captureQuota = async (runId: string, parsed: ParsedRateLimits): Promise<void> => {
    if (!deps.quota) return;
    if (!parsed.ok) {
      log("WARNING", "quota reading discarded", { runId, issues: parsed.issues });
      return;
    }
    if (parsed.readings.length === 0) return;
    try {
      const stored = await deps.quota.latest("claude-sub");
      const believed = parsed.readings.filter((reading) => {
        const reason = quotaRejection(
          reading,
          stored.find((r) => r.window === reading.window),
          now(),
        );
        if (reason)
          log("WARNING", "quota reading rejected", { runId, window: reading.window, reason });
        return reason === null;
      });
      await deps.quota.save(believed);
    } catch (err) {
      log("ERROR", "quota reading not saved", { runId, error: String(err) });
    }
  };

  const parseUsage = (runId: string, raw: unknown): RunUsage | null => {
    if (raw === undefined || raw === null) return null;
    const parsed = RunUsage.safeParse(raw);
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`);
    log("WARNING", "run usage discarded", { runId, issues });
    return null;
  };

  /** Against the readings stored before this report's. Best effort, like captureQuota. */
  const measureQuota = async (
    runId: string,
    parsed: ParsedRateLimits,
  ): Promise<QuotaDelta | null> => {
    if (!deps.quota || !parsed.ok || parsed.readings.length === 0) return null;
    let before: QuotaReading[];
    try {
      before = await deps.quota.latest("claude-sub");
    } catch (err) {
      log("ERROR", "quota reading not read", { runId, error: String(err) });
      return null;
    }
    return quotaDelta(before, parsed.readings);
  };

  app.get(RUN_CONTEXT_PATH, async (c) => {
    const runId = RunId.safeParse(c.req.param("runId"));
    if (!runId.success) return c.json({ error: "not found" }, 404);
    const caller = await authenticate(c.req.header("authorization"), runId.data);
    if (caller === "limited") return c.json({ error: "rate limited" }, 429);
    if (!caller) return c.json({ error: "unauthenticated" }, 401);
    // After verification, so unauthenticated floods can't use up the cap.
    if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);
    const context = await deps.runs.context(runId.data, caller);
    log("INFO", "run context served", { runId: runId.data, caller: callerLabel(caller) });
    return c.json(context, 200);
  });

  app.post(
    RUN_HEARTBEAT_PATH,
    bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: "request body too large" }, 413) }),
    async (c) => {
      const runId = RunId.safeParse(c.req.param("runId"));
      if (!runId.success) return c.json({ error: "not found" }, 404);
      const caller = await authenticate(c.req.header("authorization"), runId.data);
      if (caller === "limited") return c.json({ error: "rate limited" }, 429);
      if (!caller) return c.json({ error: "unauthenticated" }, 401);
      if (!("runnerId" in caller)) return c.json({ error: "only a local runner heartbeats" }, 403);
      if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);
      const body = RunHeartbeatRequest.safeParse(await c.req.json().catch(() => ({})));
      if (!body.success) return c.json({ error: "invalid request" }, 400);
      const beat = await deps.runs.heartbeat(runId.data, caller);
      if (beat.cancel) log("INFO", "heartbeat answered cancel", { runId: runId.data });
      return c.json(beat, 200);
    },
  );

  app.post(
    RUN_REPORT_PATH,
    bodyLimit({
      maxSize: RUN_REPORT_MAX_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
    }),
    async (c) => {
      const runId = RunId.safeParse(c.req.param("runId"));
      if (!runId.success) return c.json({ error: "not found" }, 404);
      const caller = await authenticate(c.req.header("authorization"), runId.data);
      if (caller === "limited") return c.json({ error: "rate limited" }, 429);
      if (!caller) return c.json({ error: "unauthenticated" }, 401);
      if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);
      const body = RunReportRequest.safeParse(await c.req.json().catch(() => null));
      if (!body.success) {
        const details = body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        return c.json({ error: "invalid request", details }, 400);
      }
      const { rateLimits, usage, ...report } = body.data;
      const limits = parseRateLimits(rateLimits, now());
      const result = await deps.runs.report(runId.data, caller, {
        ...report,
        usage: parseUsage(runId.data, usage),
        quotaDelta: await measureQuota(runId.data, limits),
      });
      // A replayed report carries an old reading; it must not refresh takenAt.
      if (result === "recorded") await captureQuota(runId.data, limits);
      return c.json({ result }, 200);
    },
  );
}
