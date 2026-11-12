import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDeps } from "./tools";

/** Andy's clear of a quota idle over MCP (AI-74); same rule as POST /api/quota/clear. */
export function registerQuotaTools(
  server: McpServer,
  deps: Pick<ToolDeps, "quota" | "email" | "actor">,
  run: <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>,
): void {
  const clearer = deps.quota;
  if (!clearer) return;
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
