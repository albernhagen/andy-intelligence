import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  WorkTrackerError,
  type CodeEventLog,
  type CodeHostConnectionStore,
  type OAuthGrantStore,
  type WorkTracker,
} from "@andy/contracts";
import { exchangeManifestCode, type CreatedApp } from "@andy/github";
import { DomainError, ProjectService, TicketService } from "@andy/domain";
import { bodyLimit } from "hono/body-limit";
import { requireAllowedUser, type AuthEnv, type TokenVerifier } from "./auth";
import { registerMcp, type ClientMetadataResolver } from "./mcp";
import { registerTicketRoutes } from "./tickets";
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
  reason_required: 422,
  forbidden: 403,
  invalid_repo: 422,
  repo_taken: 409,
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

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const, version: deps.version }, 200));

  app.get("/config.json", (c) => c.json(deps.webConfig));

  const github = deps.github;
  const now = github?.now ?? (() => new Date());
  const connection = github
    ? new GitHubConnection(github.connections, github.codeHostFor ?? gitHubCodeHost, () =>
        now().getTime(),
      )
    : null;

  // Public, outside /api: GitHub signs webhooks (HMAC); CI jobs present an Actions OIDC token.
  if (github && connection) {
    registerGitHubWebhook(app, {
      secret: async () => (await connection.get())?.webhookSecret ?? null,
      events: github.events,
      tracker: deps.tracker,
      now,
    });
    registerGitHubToken(app, {
      connection,
      verify: github.verifyActionsToken ?? actionsTokenVerifier(github.publicUrl),
      now,
    });
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

  // One TicketService for REST and MCP: both get the same ticket rules (packages/domain).
  const service = new TicketService(deps.tracker);
  registerTicketRoutes(
    app,
    deps.tracker,
    service,
    new ProjectService(deps.tracker, connection ? new ConnectedCodeHost(connection) : null),
  );

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
