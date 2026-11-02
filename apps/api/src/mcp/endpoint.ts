import type { OAuthGrantStore } from "@andy/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthEnv } from "../auth";
import { mcpUrls } from "./oauth";
import { hashToken } from "./tokens";

const MCP_BODY_BYTES = 256 * 1024;

export interface McpEndpointDeps {
  publicUrl: string;
  grants: OAuthGrantStore;
  allowedEmails: ReadonlySet<string>;
  version: string;
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
    const grant = match?.[1] ? await deps.grants.get(hashToken(match[1])) : null;
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
 * Run instance can answer). M1.1: MCP OAuth spike ships only the throwaway `ping` tool.
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
    const { email } = c.get("identity");
    const server = new McpServer({ name: "andy-intelligence", version: deps.version });
    server.registerTool(
      "ping",
      { description: "Checks the connection. Returns who you are signed in as." },
      async () => ({ content: [{ type: "text", text: `pong (signed in as ${email})` }] }),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
