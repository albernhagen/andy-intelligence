import { Project, WorkTrackerError } from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { sendTestEmail } from "../notify";
import type { ToolDeps } from "./tools";

/**
 * Needs-you email over MCP (AI-77): `set_email_notifications`, same rule as PATCH
 * /api/projects/{id} (AI-40 parity); `test_email`, the same send and cap as
 * POST /api/notify/email/test (AI-289).
 */

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
          { actor: deps.actor, email: deps.email },
        );
        return {
          project: updated.key,
          emailNotifications: updated.emailNotifications,
          emailConfigured: Boolean(deps.notifyEmail),
        };
      }),
  );

  server.registerTool(
    "test_email",
    {
      description:
        "Sends Andy one test email to check Needs-you email works, as the settings page's Send test does. It counts toward the daily cap (20 a day). Refused, with the reason, when email is not configured (runbook email-notifications.md), when today's emails are used, or when the email provider refuses the send (that one isn't counted).",
      inputSchema: {},
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    () =>
      run(async () => {
        const outcome = await sendTestEmail(deps.notifyEmail ?? null);
        if (!outcome.sent) throw new WorkTrackerError("conflict", outcome.error);
        return { sent: true, emailConfigured: true };
      }),
  );
}
