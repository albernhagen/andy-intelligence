import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDeps } from "./tools";

/**
 * Quota over MCP: `get_quota` reads what GET /api/quota returns, through the same service call
 * (AI-286); `clear_quota_idle` is Andy's clear of a quota idle (AI-74), same rule as
 * POST /api/quota/clear.
 */
export function registerQuotaTools(
  server: McpServer,
  deps: Pick<ToolDeps, "quota" | "email" | "actor">,
  run: <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>,
): void {
  const clearer = deps.quota;
  if (!clearer) return;
  server.registerTool(
    "get_quota",
    {
      description:
        "Reads the Claude subscription quota, as the Quota panel shows it: the latest reading per window (5-hour and weekly) with its used share, reset time, freshness and level (ok, warn, pause or unknown), and the warn and pause thresholds. Read-only. Unknown when no agent task has reported a reading yet.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => run(() => clearer.status()),
  );
  server.registerTool(
    "clear_quota_idle",
    {
      description:
        "Discards the Claude quota reading that holds dispatch at the reserve (idle reason quota_reserve), when Andy doesn't believe it. Quota then reads unknown until the next agent task reports, and dispatch resumes under its other caps. The reading is kept, marked with who and when, and the clear shows in the digest. Refused when no reading is at the reserve or it was already cleared.",
      inputSchema: {},
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    () => run(() => clearer.clearIdle({ actor: deps.actor, email: deps.email })),
  );
}
