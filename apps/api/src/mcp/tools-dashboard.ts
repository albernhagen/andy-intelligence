import { DASHBOARD_DEFAULT_WEEKS, DASHBOARD_MAX_WEEKS, Project } from "@andy/contracts";
import { dashboardWindow } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Run, ToolDeps } from "./tools";

/**
 * Dashboards and DORA metrics over MCP (AI-295: Parity). `dashboard` reads through the same
 * readers as the Dashboards routes: GET /api/dashboard without a project; with one,
 * GET /api/projects/:id/dashboard and GET /api/projects/:id/dora together. Read-only.
 */
export function registerDashboardTools(
  server: McpServer,
  deps: Pick<ToolDeps, "dashboard" | "dora" | "now">,
  run: Run,
): void {
  const { dashboard, dora } = deps;
  if (!dashboard || !dora) return;
  const now = deps.now ?? (() => new Date());
  server.registerTool(
    "dashboard",
    {
      description:
        "The Dashboards page's figures, computed on request. Without `project`: delivery (tickets by stage per week, lead time, rework, CI green on first try, review blockers) and cost per week, summed across projects and then per project. With `project`: that project's delivery, cost and costliest agent tasks, plus its DORA metrics over 30 and 90 days (deploy frequency, lead time, change failure rate, time to restore). Read-only.",
      inputSchema: {
        project: z
          .string()
          .transform((k) => k.trim().toUpperCase())
          .pipe(Project.shape.key)
          .optional()
          .describe('Project key, e.g. "AI". Omit for every project.'),
        weeks: z
          .number()
          .int()
          .min(1)
          .max(DASHBOARD_MAX_WEEKS)
          .optional()
          .describe(
            `UTC weeks covered, Monday first, the last ending now: 1 to ${DASHBOARD_MAX_WEEKS}. Default ${DASHBOARD_DEFAULT_WEEKS}.`,
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ project, weeks }) =>
      run(async () => {
        const window = dashboardWindow(now(), weeks);
        if (!project) return dashboard.all(window);
        const projectId = project.toLowerCase();
        const [delivery, metrics] = await Promise.all([
          dashboard.project(projectId, window),
          dora.report(projectId),
        ]);
        return { dashboard: delivery, dora: metrics };
      }),
  );
}
