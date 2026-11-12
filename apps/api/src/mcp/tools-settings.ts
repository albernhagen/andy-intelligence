import { Project, WorkTrackerError, type WorkTracker } from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * Read-only: every per-project setting the settings page shows (AI-46). Builds is read here and
 * set only in the app (ADR-0063), so this file has no setter.
 */

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const SettingsInput = {
  project: z
    .string()
    .transform((k) => k.trim().toUpperCase())
    .pipe(Project.shape.key)
    .describe('Project key, e.g. "AI". Call `status` with no ticket to list projects.'),
};

/** The project's switches as MCP shows them; identity fields only to say which project it is. */
export const settingsOf = (p: Project) => ({
  project: p.key,
  name: p.name,
  buildEnabled: p.buildEnabled,
  buildEnabledBy: p.buildEnabledBy,
  buildEnabledAt: p.buildEnabledAt,
  autoBuild: p.autoBuild,
  planApproval: p.planApproval,
  autoRefine: p.autoRefine,
  dailyQuestionCap: p.dailyQuestionCap,
  autoMerge: p.autoMerge,
  runsAtOnce: p.runsAtOnce,
  paused: p.paused,
  defaultWorker: p.defaultWorker,
  emailNotifications: p.emailNotifications,
  lastDispatch: p.lastDispatch,
});

export function registerSettingsTools(server: McpServer, tracker: WorkTracker, run: Run): void {
  server.registerTool(
    "get_project_settings",
    {
      description:
        "Reads every setting of one project: Builds (buildEnabled, with who turned it on or off and when; set only in the app), auto-build, plan approval, auto-refine, questions per day, auto-merge, agent tasks at once (runsAtOnce), paused, default worker, email notifications (sent only once email is configured: set_email_notifications says), and the dispatcher's last decision (lastDispatch: why it is idle, or what it did). Each setting has its own set_* tool except Builds.",
      inputSchema: SettingsInput,
      annotations: { readOnlyHint: true },
    },
    ({ project }) =>
      run(async () => {
        const found = await tracker.getProject(project.toLowerCase());
        if (!found) throw new WorkTrackerError("not_found", `project ${project} not found`);
        return settingsOf(found);
      }),
  );
}
