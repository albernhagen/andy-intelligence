import type { Hono } from "hono";
import type { AuthEnv } from "../auth";
import { registerMcpEndpoint } from "./endpoint";
import { registerOAuthRoutes, type McpAuthDeps } from "./oauth";
import { FixedWindowLimiter } from "./rate-limit";
import type { ToolServices } from "./tools";
import type { ProjectAccess } from "../project-access";
import type { RouteModule } from "../services";

/** Grant-store lookups per minute per instance from callers without a valid session. */
export const LOOKUPS_PER_MINUTE = 120;

export { ClientMetadataResolver, CLAUDE_CLIENT_HOSTS } from "./client-metadata";
export type { McpAuthDeps } from "./oauth";

/** Registers the MCP OAuth server and the /mcp endpoint (ADR-0039: MCP OAuth facade). */
export function registerMcp(
  app: Hono<AuthEnv>,
  deps: McpAuthDeps & { version: string; services: ToolServices; projectAccess?: ProjectAccess },
) {
  const lookups = new FixedWindowLimiter(LOOKUPS_PER_MINUTE, 60 * 1000);
  registerOAuthRoutes(app, { ...deps, lookups });
  registerMcpEndpoint(app, { ...deps, lookups });
}

/**
 * Listed in `api-routes.ts` (AI-145): after the /api middleware, so /api/oauth/approve requires
 * the allow-listed user; the other MCP and OAuth paths check their own caller. Absent when MCP
 * is not configured.
 */
export const apiRoutes: RouteModule = (app, s) => {
  const mcp = s.deps.mcp;
  if (!mcp) return;
  registerMcp(app, {
    ...mcp,
    allowedEmails: s.deps.allowedEmails,
    version: s.deps.version,
    services: s,
    projectAccess: s.deps.projectAccess,
  });
};
