import { Project } from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolDeps } from "./tools";

/** Needs-you email over MCP (AI-77); same rule as PATCH /api/projects/{id} (AI-40 parity). */

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const EmailInput = {
  project: z
    .string()
    .transform((k) => k.trim().toUpperCase())
    .pipe(Project.shape.key)
    .describe('Project key, e.g. "AI". Call `status` with no ticket to list projects.'),
  enabled: z.boolean().describe("true: email Andy when this project's tickets start to need him."),
};

export function registerNotifyTools(server: McpServer, deps: ToolDeps, run: Run): void {
  server.registerTool(
    "set_email_notifications",
    {
      description:
        "Turns a project's Needs-you email on or off. On: when a ticket starts to need Andy, an email names it (items within 10 minutes share one email; at most 20 a day). Nothing is sent while email is not configured (emailConfigured false: runbook email-notifications.md).",
      inputSchema: EmailInput,
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    ({ project, enabled }) =>
      run(async () => {
        const updated = await deps.projects.update(
          project.toLowerCase(),
          { emailNotifications: enabled },
          deps.email,
        );
        return {
          project: updated.key,
          emailNotifications: updated.emailNotifications,
          emailConfigured: Boolean(deps.notifyEmail),
        };
      }),
  );
}
