import type { Hono } from "hono";
import type { RunService } from "@andy/domain";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "@hono/zod-openapi";
import type { AuthEnv } from "./auth";
import { FixedWindowLimiter } from "./mcp/rate-limit";

/**
 * Run watchdog endpoint (M1.6b, ARCHITECTURE §7.1, §9). The watchdog queue calls it once per
 * run, at the run's deadline, with a Google OIDC token for the invoker service account
 * (audience = PUBLIC_URL). Anything else is refused. A late or replayed call is a no-op: the
 * run's status changes are conditional on its current status.
 */

export const RUN_WATCHDOG_PATH = "/runs/:runId/watchdog";
/** Verified watchdog calls per instance per minute (max 2 instances; ADR-0028). */
export const RUN_WATCHDOG_RATE_LIMIT = 30;

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";

/** Resolves when the token is a valid Google ID token for the invoker; throws otherwise. */
export type InvokerTokenVerifier = (jwt: string) => Promise<void>;

/** Verifies signature (Google's JWKS, cached by jose), issuer, audience, expiry and SA email. */
export function invokerTokenVerifier(
  audience: string,
  invokerEmail: string,
  /** Test seam: a local key set instead of Google's. */
  jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_JWKS)),
): InvokerTokenVerifier {
  return async (jwt) => {
    const { payload } = await jwtVerify(jwt, jwks, { issuer: GOOGLE_ISSUERS, audience });
    if (payload.email !== invokerEmail || payload.email_verified !== true) {
      throw new Error("token is not the invoker service account's");
    }
  };
}

const RunId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

function log(severity: "INFO" | "WARNING", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "run-watchdog", ...fields }));
}

export interface RunWatchdogDeps {
  runs: RunService;
  verify: InvokerTokenVerifier;
  now?: () => Date;
}

export function registerRunWatchdog(app: Hono<AuthEnv>, deps: RunWatchdogDeps): void {
  const now = deps.now ?? (() => new Date());
  const limiter = new FixedWindowLimiter(RUN_WATCHDOG_RATE_LIMIT, 60_000, () => now().getTime());

  app.post(RUN_WATCHDOG_PATH, async (c) => {
    const runId = RunId.safeParse(c.req.param("runId"));
    if (!runId.success) return c.json({ error: "not found" }, 404);
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    try {
      if (!match?.[1]) throw new Error("no bearer token");
      await deps.verify(match[1]);
    } catch {
      log("WARNING", "watchdog token rejected", { runId: runId.data });
      return c.json({ error: "unauthenticated" }, 401);
    }
    // After verification, so unauthenticated floods can't use up the cap.
    if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);
    const outcome = await deps.runs.checkDeadline(runId.data);
    log("INFO", "watchdog check done", { runId: runId.data, outcome });
    // Early: a non-2xx makes the queue deliver it again later (its retry policy).
    return c.json({ outcome }, outcome === "early" ? 503 : 200);
  });
}
