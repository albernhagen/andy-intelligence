import { CONFIG_CHANGE_LIST_MAX, Project } from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolDeps } from "./tools";

const ProjectKey = z
  .string()
  .transform((k) => k.trim().toUpperCase())
  .pipe(Project.shape.key)
  .describe('Project key, e.g. "AI". Call `status` with no ticket to list projects.');

/**
 * A project's settings change log and its revert over MCP (M4.12): the same ConfigRevert rules
 * as the REST routes and the settings page. Named `*_settings_change*` because
 * `list_config_changes` already lists pending proposals (ADR-0097).
 */
export function registerConfigLogTools(
  server: McpServer,
  deps: Pick<ToolDeps, "configRevert" | "actor" | "email">,
  run: <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>,
): void {
  const revert = deps.configRevert;
  if (!revert) return;

  server.registerTool(
    "list_settings_changes",
    {
      description: `A project's settings changes, newest first (at most ${CONFIG_CHANGE_LIST_MAX}): each with its id, the changed fields' before and after (diff), who (actor), when (createdAt), reason, and status (applied, or reverted). The same list as the settings page; project routing saves are listed too (entity routing) and revert with revert_settings_change or revert_routing_change.`,
      inputSchema: {
        project: ProjectKey,
        limit: z.number().int().min(1).max(CONFIG_CHANGE_LIST_MAX).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ project, limit }) =>
      run(async () => ({ changes: await revert.list(project.toLowerCase(), limit) })),
  );

  server.registerTool(
    "revert_settings_change",
    {
      description:
        "Reverts one applied settings change as Andy (owner only): its fields go back to their before values through the normal settings write, which is logged as a new change, and the original is marked reverted. Refused when a field changed since (the error names the newer change), and for a change that switches Builds (set only in the app).",
      inputSchema: {
        project: ProjectKey,
        id: z
          .string()
          .regex(/^[A-Za-z0-9-]{1,64}$/)
          .describe("The change's id, from `list_settings_changes`."),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ project, id }) =>
      run(() =>
        revert.revert(project.toLowerCase(), id, { actor: deps.actor, email: deps.email }, "mcp"),
      ),
  );
}
