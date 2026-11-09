import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  WorkTrackerError,
  type CodeEventLog,
  type CodeHostConnectionStore,
  type OAuthGrantStore,
  type RunStore,
  type WatchdogQueue,
  type WorkTracker,
  type QuotaStore,
} from "@andy/contracts";
import { ClaudeCodeActionsExecutor, exchangeManifestCode, type CreatedApp } from "@andy/github";
import {
  BuildDispatcher,
  DomainError,
  ProjectService,
  RefineDispatcher,
  RunService,
  BoardReader,
  TicketService,
} from "@andy/domain";
import { bodyLimit } from "hono/body-limit";
import { requireAllowedUser, type AuthEnv, type TokenVerifier } from "./auth";
import { registerMcp, type ClientMetadataResolver } from "./mcp";
import { registerQuotaRoutes } from "./quota";
import { registerRunCallbacks, registerRunRoutes } from "./runs";
import { registerTicketRoutes } from "./tickets";
import { registerBoardRoutes } from "./board";
import {
  ConnectedCodeHost,
  GitHubConnection,
  gitHubCodeHost,
  type CodeHostFactory,
} from "./github/connection";
import { registerGitHubSetup } from "./github/setup";
import {
  actionsTokenVerifier,
  registerGitHubToken,
  type ActionsTokenVerifier,
} from "./github/token";
import { registerGitHubWebhook } from "./github/webhooks";
import { invokerTokenVerifier, registerRunWatchdog, type InvokerTokenVerifier } from "./watchdog";

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
  /** Subscription quota readings (M1.9). Without it every window reads unknown. */
  quota?: QuotaStore;
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
  run_finished: 409,
  executor_unavailable: 503,
  dispatch_failed: 502,
  cancel_failed: 502,
  plan_not_decidable: 409,
  not_promotable: 409,
} as const;

export function createApp(deps: AppDeps) {
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

  const github = deps.github;
  const now = github?.now ?? (() => new Date());
  const connection = github
    ? new GitHubConnection(github.connections, github.codeHostFor ?? gitHubCodeHost, () =>
        now().getTime(),
      )
    : null;

  // Runs dispatch through the GitHub App; without it, starting a run is refused (503).
  // The dispatchers start the next waiting run after each report or watchdog end, ticket
  // create, last answer, move to Ready and switch turned on: a build first (ADR-0063, projects
  // with autoBuild), else a refine (ADR-0054). Builds start up to the caps (ADR-0079), then
  // projects waiting on the global cap get their turn. `next` and `wakeGlobalCapWaiters` never throw.
  const runs = new RunService(
    deps.tracker,
    deps.runs,
    connection ? new ClaudeCodeActionsExecutor(new ConnectedCodeHost(connection)) : null,
    now,
    deps.watchdog?.queue ?? null,
    async (projectId) => void (await dispatchNext(projectId)),
  );
  const refiner = new RefineDispatcher(deps.tracker, deps.runs, runs, now);
  const builder = new BuildDispatcher(deps.tracker, deps.runs, runs, now, deps.quota ?? null);
  const dispatchNext = async (projectId: string) => {
    const started = (await builder.next(projectId)) ?? (await refiner.next(projectId));
    await builder.wakeGlobalCapWaiters(projectId);
    return started;
  };
  // One TicketService for REST, MCP and webhooks: all get the same ticket rules (packages/domain).
  const service = new TicketService(deps.tracker, runs, dispatchNext);

  // Public, outside /api: the watchdog queue presents a Google OIDC token for the invoker SA.
  if (deps.watchdog) {
    registerRunWatchdog(app, {
      runs,
      verify:
        deps.watchdog.verifyInvokerToken ??
        invokerTokenVerifier(deps.watchdog.publicUrl, deps.watchdog.invokerEmail),
      now,
    });
  }

  // Public, outside /api: GitHub signs webhooks (HMAC); CI jobs present an Actions OIDC token.
  if (github && connection) {
    const verifyActionsToken = github.verifyActionsToken ?? actionsTokenVerifier(github.publicUrl);
    registerGitHubWebhook(app, {
      secret: async () => (await connection.get())?.webhookSecret ?? null,
      events: github.events,
      tracker: deps.tracker,
      tickets: service,
      codeHost: new ConnectedCodeHost(connection),
      runs: deps.runs,
      now,
    });
    registerGitHubToken(app, {
      connection,
      verify: verifyActionsToken,
      claimRunGrant: (runId, caller) => runs.claimPushGrant(runId, caller),
      now,
    });
    registerRunCallbacks(app, { runs, verify: verifyActionsToken, now, quota: deps.quota });
  }

  app.use("/api/*", requireAllowedUser(deps.verifier, deps.allowedEmails));
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
    }),
  );

  app.openapi(meRoute, (c) => {
    const { email, uid } = c.get("identity");
    return c.json({ email, uid }, 200);
  });

  const projects = new ProjectService(
    deps.tracker,
    connection ? new ConnectedCodeHost(connection) : null,
    dispatchNext,
    now,
  );
  registerTicketRoutes(app, deps.tracker, service, projects);
  registerBoardRoutes(app, new BoardReader(deps.tracker, deps.runs));

  registerRunRoutes(app, runs);
  registerQuotaRoutes(app, deps.quota ?? null, now);

  if (github && connection) {
    registerGitHubSetup(app, {
      publicUrl: github.publicUrl,
      connection,
      exchangeCode: github.exchangeCode ?? ((code) => exchangeManifestCode(code)),
      now,
    });
  }

  // After the /api middleware, so /api/oauth/approve requires the allow-listed user.
  if (deps.mcp) {
    registerMcp(app, {
      ...deps.mcp,
      allowedEmails: deps.allowedEmails,
      version: deps.version,
      tracker: deps.tracker,
      service,
      runs,
      projects,
    });
  }

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
