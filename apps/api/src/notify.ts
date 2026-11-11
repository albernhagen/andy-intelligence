import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { EMAIL_BATCH_WINDOW_MS, EMAIL_DAILY_CAP, type EmailNotifications } from "@andy/domain";
import type { Hono } from "hono";
import type { AuthEnv } from "./auth";
import { FixedWindowLimiter } from "./mcp/rate-limit";
import type { InvokerTokenVerifier } from "./watchdog";

/**
 * Email for the Needs-you inbox (AI-77): the settings page's status and test send, and the
 * batching window's flush endpoint the queue calls.
 */

export const NOTIFY_FLUSH_PATH = "/notify/email/flush";
/** Verified flush calls per instance per minute, as the run watchdog (one per window is the norm; ADR-0028). */
export const NOTIFY_FLUSH_RATE_LIMIT = 30;

export const EmailStatus = z
  .object({
    /** The API key and both addresses are set; off otherwise, whatever the project setting. */
    configured: z.boolean(),
    sentToday: z.number().int().min(0),
    dailyCap: z.number().int(),
    windowMinutes: z.number().int(),
  })
  .openapi("EmailStatus");
export type EmailStatus = z.infer<typeof EmailStatus>;

const ErrorBody = z.object({ error: z.string() });

const statusRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/notify/email",
  responses: {
    200: {
      content: { "application/json": { schema: EmailStatus } },
      description: "Whether Needs-you email is configured, and today's count against the cap",
    },
  },
});

const testRoute = createRoute({
  security: [{ bearer: [] }],
  method: "post",
  path: "/api/notify/email/test",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ sent: z.literal(true) }) } },
      description: "A test email went out; it counts toward the daily cap",
    },
    409: {
      content: { "application/json": { schema: ErrorBody } },
      description: "Email is not configured, or today's cap is reached",
    },
    502: {
      content: { "application/json": { schema: ErrorBody } },
      description:
        "The email provider refused the send (e.g. a bad key or unverified domain); not counted",
    },
  },
});

/** Status for the settings page; null `email`: not configured. */
export async function emailStatus(email: EmailNotifications | null): Promise<EmailStatus> {
  return {
    configured: email !== null,
    sentToday: email ? await email.sentToday() : 0,
    dailyCap: EMAIL_DAILY_CAP,
    windowMinutes: EMAIL_BATCH_WINDOW_MS / 60_000,
  };
}

export function registerNotifyRoutes(
  app: OpenAPIHono<AuthEnv>,
  email: EmailNotifications | null,
): void {
  app.openapi(statusRoute, async (c) => c.json(await emailStatus(email), 200));

  app.openapi(testRoute, async (c) => {
    if (!email) return c.json({ error: "email is not configured" }, 409);
    const outcome = await email.sendTest();
    if (outcome.result === "cap_reached") {
      return c.json({ error: `today's ${EMAIL_DAILY_CAP} emails are used` }, 409);
    }
    if (outcome.result === "failed") {
      // The provider's error names the cause (key, domain); it never holds the key itself.
      return c.json({ error: `test email not sent: ${outcome.error}` }, 502);
    }
    return c.json({ sent: true as const }, 200);
  });
}

/**
 * Public, outside /api: the queue calls it when a batching window ends, with a Google OIDC
 * token for the invoker service account (as the run watchdog). Anything else is refused. A
 * repeat call finds the window empty; an early one answers 503 so the queue retries later.
 */
export function registerNotifyFlush(
  app: Hono<AuthEnv>,
  deps: { email: EmailNotifications; verify: InvokerTokenVerifier; now: () => Date },
): void {
  const limiter = new FixedWindowLimiter(NOTIFY_FLUSH_RATE_LIMIT, 60_000, () =>
    deps.now().getTime(),
  );
  app.post(NOTIFY_FLUSH_PATH, async (c) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    try {
      if (!match?.[1]) throw new Error("no bearer token");
      await deps.verify(match[1]);
    } catch {
      console.log(
        JSON.stringify({
          severity: "WARNING",
          message: "email flush token rejected",
          component: "notify-email",
        }),
      );
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);
    const outcome = await deps.email.flush();
    return c.json({ outcome }, outcome === "early" ? 503 : 200);
  });
}
