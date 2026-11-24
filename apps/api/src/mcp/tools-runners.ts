import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RUNNER_ID_SHAPE } from "../runners";
import type { Run, ToolDeps } from "./tools";

/**
 * Local runners over MCP. `list_runners` (AI-294, ADR-0135) reads what GET /api/runners returns;
 * `revoke_runner` (AI-351, ADR-0143) does what POST /api/runners/:runnerId/revoke does, through
 * the same `RunnerService` calls, so the owner check (`revoke_runner`) and the "runner revoked"
 * log are the route's. Registering stays in the app: its secret is shown once and must not land
 * in a chat transcript.
 */
export function registerRunnerTools(server: McpServer, deps: ToolDeps, run: Run): void {
  const runners = deps.runners;
  if (!runners) return;
  server.registerTool(
    "list_runners",
    {
      description:
        "Lists the local runners, as the Runners page does: name, the projects whose local tickets each may claim, agent tasks at once, who registered it and when, expiry, last seen, whether it is present now, and its state (active, revoked or expired). Never a secret. Register runners in the app (Settings → Local runners); revoke one with revoke_runner.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => run(async () => ({ runners: await runners.list() })),
  );
  server.registerTool(
    "revoke_runner",
    {
      description:
        "Revokes a local runner, as the Runners page does: its next claim is refused and runs it holds lose their lease. Andy only. Takes the runner id from list_runners. Revoking one already revoked changes nothing. Cannot be undone: register a new runner in the app (Settings → Local runners).",
      inputSchema: {
        runnerId: z.string().regex(RUNNER_ID_SHAPE).describe("The runner's id, from list_runners."),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ runnerId }) => run(async () => ({ runner: await runners.revoke(runnerId, deps.actor) })),
  );
}
