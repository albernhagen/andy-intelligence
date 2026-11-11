import type { OAuthGrantStore, WorkTracker } from "@andy/contracts";
import type {
  DigestReader,
  EmailNotifications,
  ProjectService,
  QuotaClearer,
  RunService,
  TicketService,
} from "@andy/domain";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { actorOf, type AuthEnv } from "../auth";
import { mcpUrls } from "./oauth";
import type { FixedWindowLimiter } from "./rate-limit";
import { hashToken, isTokenShaped } from "./tokens";
import { registerTools } from "./tools";

const MCP_BODY_BYTES = 256 * 1024;

export interface McpEndpointDeps {
  publicUrl: string;
  grants: OAuthGrantStore;
  allowedEmails: ReadonlySet<string>;
  version: string;
  /** Caps grant-store lookups callers can trigger without a valid token (ADR-0028). */
  lookups: FixedWindowLimiter;
  tracker: WorkTracker;
  service: TicketService;
  runs: RunService;
  projects: ProjectService;
  digest: DigestReader;
  /** Needs-you email (AI-77); null: not configured. */
  notifyEmail: EmailNotifications | null;
  quota: QuotaClearer;
}

/**
 * Accepts only access tokens this server issued for the MCP resource, and re-checks the
 * allow-list on every request, so removing an email revokes its tokens. Any failure is a
 * 401 that points the client at the resource metadata, which starts (re-)authorization.
 */
export function requireMcpToken(deps: McpEndpointDeps): MiddlewareHandler<AuthEnv> {
  const urls = mcpUrls(deps.publicUrl);
  return async (c, next) => {
    const match = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
    const token = match?.[1] && isTokenShaped(match[1]) ? match[1] : null;
    if (token && !deps.lookups.tryTake()) {
      c.header("retry-after", "60");
      return c.json({ error: "rate_limited" }, 429);
    }
    const grant = token ? await deps.grants.get(hashToken(token)) : null;
    if (
      !grant ||
      grant.kind !== "access" ||
      grant.resource !== urls.resource ||
      !deps.allowedEmails.has(grant.email.toLowerCase())
    ) {
      const error = match ? ', error="invalid_token"' : "";
      c.header("www-authenticate", `Bearer resource_metadata="${urls.resourceMetadata}"${error}`);
      return c.json({ error: "unauthenticated" }, 401);
    }
    c.set("identity", { uid: grant.uid, email: grant.email, emailVerified: true });
    await next();
  };
}

/**
 * Remote MCP endpoint (Streamable HTTP, stateless: a new server per request, so any Cloud
 * Run instance can answer). Tools: tools.ts (M1.4: MCP core tools).
 */
export function registerMcpEndpoint(app: Hono<AuthEnv>, deps: McpEndpointDeps) {
  app.use("/mcp", requireMcpToken(deps));
  app.use(
    "/mcp",
    bodyLimit({
      maxSize: MCP_BODY_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
    }),
  );
  app.all("/mcp", async (c) => {
    const identity = c.get("identity");
    const server = new McpServer({ name: "andy-intelligence", version: deps.version });
    registerTools(server, {
      tracker: deps.tracker,
      service: deps.service,
      runs: deps.runs,
      projects: deps.projects,
      digest: deps.digest,
      notifyEmail: deps.notifyEmail,
      quota: deps.quota,
      email: identity.email,
      actor: actorOf(identity),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
