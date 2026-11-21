import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  WorkTrackerError,
  type CodeEventLog,
  type ConfigChangeStore,
  type ReviewFindingSource,
  type CodeHostConnectionStore,
  type OAuthGrantStore,
  type RunStore,
  type RunnerStore,
  type WatchdogQueue,
  type WorkTracker,
  type QuotaStore,
  type DeploymentStore,
  type MilestoneStore,
  type RoutingConfigStore,
  type NightLaunchStore,
  type ProjectVersions,
  type SpendLedger,
  type ReleaseNoteStore,
  type SpendCapsStore,
  type SpendNoticeLedger,
} from "@andy/contracts";
import type { CreatedApp } from "@andy/github";
import { DomainError, type EmailNotificationsDeps } from "@andy/domain";
import { bodyLimit } from "hono/body-limit";
import * as apiRoutes from "./api-routes";
import { requireAllowedUser, type AuthEnv, type TokenVerifier } from "./auth";
import type { CodeHostFactory } from "./github/connection";
import type { ActionsTokenVerifier } from "./github/token";
import type { ClientMetadataResolver } from "./mcp";
import { requireProjectAccess, type ProjectAccess } from "./project-access";
import { readMeterMiddleware } from "./read-meter";
// Callers outside the package (web tests, e2e, gen:api) pass today's rule explicitly.
export { ownerOnlyAccess } from "./project-access";
import * as publicRoutes from "./public-routes";
import { createServices, type RouteModule } from "./services";
import type { InvokerTokenVerifier } from "./watchdog";

/** Request body cap for /api/* (ADR-0028: everything that can grow gets a cap). */
export const MAX_BODY_BYTES = 256 * 1024;

export interface WebConfig {
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  projectId: string;
}

export interface AppDeps {
  verifier: TokenVerifier;
  allowedEmails: ReadonlySet<string>;
  version: string;
  /** Public Firebase web config (not secret) served to the SPA. */
  webConfig: WebConfig;
  tracker: WorkTracker;
  /** Agent run records (M1.6a: Claude Code executor). */
  runs: RunStore;
  /**
   * Local runners (ADR-0089): `/settings/runners` and `POST /runner/claim`. Off (routes absent)
   * when not configured.
   */
  runners?: RunnerStore;
  /**
   * Config changes: pending ones from review findings (ADR-0097; routes absent when unset) and
   * the log every project-settings write appends to (M4.11; off when unset).
   */
  configChanges?: ConfigChangeStore;
  /** Stored review findings (ADR-0097 PR B); until then none, so sweeps propose nothing. */
  reviewFindings?: ReviewFindingSource;
  /**
   * Release notes (AI-159): merged PRs store one (webhook) and What's new reads them. Off (no
   * route, no MCP tool) when unset.
   */
  releaseNotes?: ReleaseNoteStore;
  /**
   * Milestones (ADR-0131). Dispatch, night launches (AI-306) and the roadmap (AI-305) read them;
   * unset, a ticket with a milestone is held and one without runs as before, and the roadmap lists
   * every epic under No milestone. Absent: no milestone routes or tools (AI-304).
   */
  milestones?: MilestoneStore;
  /** Subscription quota readings (M1.9). Without it every window reads unknown. */
  quota?: QuotaStore;
  /** Night launches (ADR-0049): a launched story's build gets its `epic/<KEY>` base (AI-122). */
  nightLaunches?: NightLaunchStore;
  /**
   * Deployment records (AI-161): written by deploy workflows' reports (AI-180, routes absent when
   * unset) and read by the DORA panel (AI-200, empty when unset).
   */
  deployments?: DeploymentStore;
  /** Model routing (AI-230, AI-238); without it every run takes `DEFAULT_ROUTING`. */
  routing?: RoutingConfigStore;
  /**
   * Paid spend: the gate reserves pay_per_use agent tasks (AI-248) and the caps settings read its
   * totals (AI-249). Without it every pay_per_use task is refused and spend reads unknown.
   */
  spendLedger?: SpendLedger;
  /** The global spend caps (AI-276); without it the code defaults, read-only. */
  spendCapsStore?: SpendCapsStore;
  /**
   * What the spend notices have sent (AI-257: M10.9): their dedupe and daily cap. Absent: the
   * gate sends no spend notices.
   */
  spendNotices?: SpendNoticeLedger;
  /**
   * Per-project change counters (AI-222): with them, every tracker and run write bumps its
   * project, and the board and ticket list serve unchanged polls from a cache. Without, no cache.
   */
  projectVersions?: ProjectVersions;
  /**
   * Who may read which project (AI-252: M8.3), for `/api` and MCP alike. Required, with no
   * default, so a wiring omission can't turn the check off: `main.ts` passes `ownerOnlyAccess()`.
   */
  projectAccess: ProjectAccess;
  /**
   * The only host served (ADR-0044), e.g. `ai.andybernhagen.com`. Requests for any other host
   * (the default run.app URLs) get 404, except /health for monitoring. Unset: every host (local dev).
   */
  publicHost?: string;
  /**
   * Run watchdog (M1.6b, §7.1): each dispatched run queues a check at its deadline, delivered
   * to `/runs/{id}/watchdog` with the invoker's OIDC token. Off (no checks, route absent) when
   * not configured, e.g. local dev.
   */
  watchdog?: {
    queue: WatchdogQueue;
    /** The OIDC audience: `PUBLIC_URL`. */
    publicUrl: string;
    /** The invoker service account the queue's tokens must be for. */
    invokerEmail: string;
    /** Test seam; defaults to Google's ID token verification. */
    verifyInvokerToken?: InvokerTokenVerifier;
  };
  /** MCP endpoint + its OAuth server; off (routes absent) when not configured. */
  mcp?: {
    publicUrl: string;
    grants: OAuthGrantStore;
    clients: ClientMetadataResolver;
    now?: () => Date;
  };
  /**
   * Needs-you email (AI-77): when set, a ticket that starts to need Andy is emailed, batched and
   * capped. Absent: email is off and the settings page says so.
   */
  email?: Omit<EmailNotificationsDeps, "tracker">;
  /**
   * GitHub App (ADR-0041, ADR-0043): setup from the UI, webhook receiver, repo checks at
   * registration, repo tokens for CI. Off (routes absent) when not configured, e.g. local dev.
   */
  github?: {
    /** This service's public origin: manifest URLs and the Actions OIDC audience. */
    publicUrl: string;
    connections: CodeHostConnectionStore;
    events: CodeEventLog;
    /** Test seams; default to the real GitHub calls. */
    codeHostFor?: CodeHostFactory;
    exchangeCode?: (code: string) => Promise<CreatedApp>;
    verifyActionsToken?: ActionsTokenVerifier;
    now?: () => Date;
  };
}

const Health = z.object({ status: z.literal("ok"), version: z.string() }).openapi("Health");
const Me = z.object({ email: z.string(), uid: z.string() }).openapi("Me");
const ErrorBody = z.object({ error: z.string() }).openapi("Error");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: { content: { "application/json": { schema: Health } }, description: "Service is up" },
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/api/me",
  security: [{ bearer: [] }],
  responses: {
    200: { content: { "application/json": { schema: Me } }, description: "Signed-in user" },
    401: { content: { "application/json": { schema: ErrorBody } }, description: "No token" },
    403: { content: { "application/json": { schema: ErrorBody } }, description: "Not allowed" },
  },
});

const DOMAIN_STATUS = {
  invalid_transition: 422,
  dor_not_met: 422,
  forbidden: 403,
  invalid_repo: 422,
  repo_taken: 409,
  invalid_step: 422,
  not_refinable: 422,
  not_buildable: 422,
  run_limit: 409,
  spend_cap: 409,
  quota_reserve: 409,
  run_finished: 409,
  executor_unavailable: 503,
  dispatch_failed: 502,
  cancel_failed: 502,
  plan_not_decidable: 409,
  not_promotable: 409,
  invalid_reference: 422,
  invalid_field: 422,
  not_clearable: 409,
  not_acceptable: 409,
  runner_limit: 409,
  runs_elsewhere: 409,
  brief_too_long: 422,
  code_host_unavailable: 503,
  rate_limited: 429,
  not_revertible: 409,
} as const;

export function createApp(input: AppDeps) {
  // The type requires it; this stops a caller that slips past the type (fail closed).
  if (!input.projectAccess) throw new Error("createApp needs a projectAccess rule");
  const services = createServices(input);
  const deps = services.deps;
  const app = new OpenAPIHono<AuthEnv>({
    // Validation failures: 400 with the field paths, not Zod's raw error object.
    defaultHook: (result, c) => {
      if (!result.success) {
        const details = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        return c.json({ error: "invalid request", details }, 400);
      }
    },
  });

  app.onError((err, c) => {
    if (err instanceof WorkTrackerError) {
      return c.json({ error: err.message }, err.code === "not_found" ? 404 : 409);
    }
    if (err instanceof DomainError) {
      return c.json({ error: err.message, details: err.details }, DOMAIN_STATUS[err.code]);
    }
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: err.message,
        stack: err.stack,
        path: c.req.path,
        method: c.req.method,
      }),
    );
    return c.json({ error: "internal error" }, 500);
  });

  // AI-315: one log line per request with the documents it read (`read-meter.ts`).
  app.use("*", readMeterMiddleware());

  // No page of ours may be framed: the OAuth consent page must not be clickjacked.
  app.use("*", async (c, next) => {
    await next();
    c.header("x-frame-options", "DENY");
    c.header("content-security-policy", "frame-ancestors 'none'");
  });

  const publicHost = deps.publicHost?.toLowerCase();
  if (publicHost) {
    app.use("*", async (c, next) => {
      if (c.req.path === "/health" || new URL(c.req.url).host === publicHost) return next();
      return c.json({ error: "not found" }, 404);
    });
  }

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const, version: deps.version }, 200));

  app.get("/config.json", (c) => c.json(deps.webConfig));

  // Public, outside /api: each checks its own caller (AI-145: listed in public-routes.ts).
  register(app, services, publicRoutes);

  // Middleware runs in registration order: everything registered below is behind it on /api/*.
  app.use("/api/*", requireAllowedUser(deps.verifier, deps.allowedEmails));
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
    }),
  );
  app.use("/api/*", requireProjectAccess(deps.projectAccess));

  app.openapi(meRoute, (c) => {
    const { email, uid } = c.get("identity");
    return c.json({ email, uid }, 200);
  });

  register(app, services, apiRoutes);

  app.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "andy-intelligence", version: deps.version },
  });

  return app;
}

/** Registers each listed module's routes (a module namespace: its exports in name order). */
function register(
  app: OpenAPIHono<AuthEnv>,
  services: ReturnType<typeof createServices>,
  modules: Record<string, RouteModule>,
): void {
  for (const routes of Object.values(modules)) routes(app, services);
}
