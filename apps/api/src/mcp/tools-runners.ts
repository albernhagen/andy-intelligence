import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Run, ToolDeps } from "./tools";

/**
 * Local runners over MCP (AI-294): `list_runners` reads what GET /api/runners returns, from the
 * same `RunnerService.list`. Read-only on purpose: registering stays in the app (its secret is
 * shown once and must not land in a chat transcript), and revoking stays in the app pending
 * Andy's decision on ADR-0089, which keeps both where a person signs in.
 */
export function registerRunnerTools(server: McpServer, deps: ToolDeps, run: Run): void {
  const runners = deps.runners;
  if (!runners) return;
  server.registerTool(
    "list_runners",
    {
      description:
        "Lists the local runners, as the Runners page does: name, the projects whose local tickets each may claim, agent tasks at once, who registered it and when, expiry, last seen, whether it is present now, and its state (active, revoked or expired). Never a secret. Read-only: register and revoke runners in the app (Settings → Local runners).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => run(async () => ({ runners: await runners.list() })),
  );
}
