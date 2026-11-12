import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  MintRunner,
  MintedRunner,
  RUNNER_LIMITS,
  RunnerClaimRequest,
  RunnerClaimResponse,
  RunnerView,
  type Runner,
} from "@andy/contracts";
import type { RunnerService } from "@andy/domain";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { actorOf, type AuthEnv } from "./auth";
import { FixedWindowLimiter } from "./mcp/rate-limit";
import { hashToken, newToken } from "./mcp/tokens";

/**
 * Local runners (ADR-0089 slice 3). Andy mints, lists and revokes runners under /api (Firebase
 * sign-in + allow-list); MCP has no runner tools, so a stolen MCP token can't add one. The
 * runner itself calls `POST /runner/claim` outside /api with its secret.
 */

/** Runner secrets: a fixed prefix (easy to spot in a leak) and 256 random bits. */
export const RUNNER_SECRET_PREFIX = "air_";
const SECRET_SHAPE = /^air_[A-Za-z0-9_-]{43}$/;

/** What the domain uses to make and hash runner secrets and per-run tokens. */
export const runnerCredentials = {
  newSecret: () => `${RUNNER_SECRET_PREFIX}${newToken()}`,
  hash: hashToken,
};

export const RUNNER_CLAIM_PATH = "/runner/claim";
/** Secret lookups per instance per minute, valid or not (max 2 instances; ADR-0028, R14). */
export const RUNNER_LOOKUPS_PER_MINUTE = 60;

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const secured = { security: [{ bearer: [] }] };
const RunnerParams = z.object({ runnerId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) });

const routes = {
  list: createRoute({
    ...secured,
    method: "get",
    path: "/api/runners",
    responses: { 200: json(z.array(RunnerView), "Runners, newest first; never their secrets") },
  }),
  mint: createRoute({
    ...secured,
    method: "post",
    path: "/api/runners",
    request: { body: { content: { "application/json": { schema: MintRunner } }, required: true } },
    responses: {
      201: json(MintedRunner, "Minted; the secret is in this response only"),
      400: json(ErrorBody, "Invalid request"),
      403: json(ErrorBody, "Only the owner mints runners"),
      404: json(ErrorBody, "A project doesn't exist"),
      409: json(ErrorBody, "The runner cap is reached"),
    },
  }),
  revoke: createRoute({
    ...secured,
    method: "post",
    path: "/api/runners/{runnerId}/revoke",
    request: { params: RunnerParams },
    responses: {
      200: json(RunnerView, "Revoked; its next claim is refused"),
      403: json(ErrorBody, "Only the owner revokes runners"),
      404: json(ErrorBody, "Not found"),
    },
  }),
};

export function registerRunnerRoutes(app: OpenAPIHono<AuthEnv>, runners: RunnerService): void {
  app.openapi(routes.list, async (c) => c.json(await runners.list(), 200));

  app.openapi(routes.mint, async (c) => {
    const minted = await runners.mint(c.req.valid("json"), actorOf(c.get("identity")));
    c.header("cache-control", "no-store");
    return c.json(minted, 201);
  });

  app.openapi(routes.revoke, async (c) => {
    const { runnerId } = c.req.valid("param");
    return c.json(await runners.revoke(runnerId, actorOf(c.get("identity"))), 200);
  });
}

function log(severity: "INFO" | "WARNING", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "runner-claim", ...fields }));
}

/** Starts the runner's next run, or answers that there is none (slice 4); null: no work. */
export type ClaimWork = (runner: Runner) => Promise<RunnerClaimResponse["run"]>;

export interface RunnerClaimDeps {
  runners: RunnerService;
  /** Absent (slice 3): every claim answers `{ run: null }`. */
  claim?: ClaimWork;
  now?: () => Date;
}

/**
 * `POST /runner/claim` (ADR-0089): the runner proves itself with its secret, at most one claim
 * per 10 s (429), and gets its next run or `{ run: null }`. Each accepted claim records
 * `lastSeenAt` (the runner is then present for 2 minutes).
 */
export function registerRunnerClaim(app: Hono<AuthEnv>, deps: RunnerClaimDeps): void {
  const now = deps.now ?? (() => new Date());
  const lookups = new FixedWindowLimiter(RUNNER_LOOKUPS_PER_MINUTE, 60_000, () => now().getTime());

  app.post(
    RUNNER_CLAIM_PATH,
    bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: "request body too large" }, 413) }),
    async (c) => {
      const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
      const secret = match?.[1];
      if (!secret || !SECRET_SHAPE.test(secret)) {
        log("WARNING", "runner claim without a runner secret");
        return c.json({ error: "unauthenticated" }, 401);
      }
      // Before the lookup, so a flood of guesses can't run up Firestore reads.
      if (!lookups.tryTake()) {
        c.header("retry-after", "60");
        return c.json({ error: "rate limited" }, 429);
      }
      const runner = await deps.runners.authenticate(secret);
      if (!runner) {
        log("WARNING", "runner claim rejected");
        return c.json({ error: "unauthenticated" }, 401);
      }
      const body = RunnerClaimRequest.safeParse(await c.req.json().catch(() => ({})));
      if (!body.success) return c.json({ error: "invalid request" }, 400);
      if ((await deps.runners.recordClaim(runner)) === "too_soon") {
        c.header("retry-after", String(RUNNER_LIMITS.minClaimIntervalSeconds));
        return c.json({ error: "claimed too soon" }, 429);
      }
      const run = deps.claim ? await deps.claim(runner) : null;
      log("INFO", "runner claimed", {
        runnerId: runner.id,
        version: body.data.version ?? null,
        runId: run?.runId ?? null,
      });
      const response: RunnerClaimResponse = {
        run,
        pollSeconds: RUNNER_LIMITS.pollSeconds,
        heartbeatSeconds: RUNNER_LIMITS.heartbeatSeconds,
      };
      c.header("cache-control", "no-store");
      return c.json(response, 200);
    },
  );
}
