import type { WorkTracker } from "@andy/contracts";
import type { DigestReader, ProjectService, RunService, TicketService } from "@andy/domain";
import type { Hono } from "hono";
import type { AuthEnv } from "../auth";
import { registerMcpEndpoint } from "./endpoint";
import { registerOAuthRoutes, type McpAuthDeps } from "./oauth";
import { FixedWindowLimiter } from "./rate-limit";

/** Grant-store lookups per minute per instance from callers without a valid session. */
export const LOOKUPS_PER_MINUTE = 120;

export { ClientMetadataResolver, CLAUDE_CLIENT_HOSTS } from "./client-metadata";
export type { McpAuthDeps } from "./oauth";

/** Registers the MCP OAuth server and the /mcp endpoint (ADR-0039: MCP OAuth facade). */
export function registerMcp(
  app: Hono<AuthEnv>,
  deps: McpAuthDeps & {
    version: string;
    tracker: WorkTracker;
    service: TicketService;
    runs: RunService;
    projects: ProjectService;
    digest: DigestReader;
  },
) {
  const lookups = new FixedWindowLimiter(LOOKUPS_PER_MINUTE, 60 * 1000);
  registerOAuthRoutes(app, { ...deps, lookups });
  registerMcpEndpoint(app, { ...deps, lookups });
}
