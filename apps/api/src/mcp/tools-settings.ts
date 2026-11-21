import { EnvironmentPolicy, Project, WorkTrackerError } from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolDeps } from "./tools";

/**
 * Every per-project setting the settings page shows (AI-46), and the environment policy's setter
 * (AI-160). Builds is read here and set only in the app (ADR-0063).
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
  executor: p.executor,
  emailNotifications: p.emailNotifications,
  environments: p.environments,
  lastDispatch: p.lastDispatch,
});

const EnvironmentsInput = {
  project: SettingsInput.project,
  environments: EnvironmentPolicy.describe(
    "prod-only (default): one prod environment plus PR previews. dev-and-prod: releases go to dev first, then are promoted to prod.",
  ),
};

// AI-292: the settings page's "Questions per day"; the same limits as PATCH /api/projects/{id}.
const DailyQuestionCapInput = {
  project: SettingsInput.project,
  dailyQuestionCap: Project.shape.dailyQuestionCap
    .unwrap()
    .describe(
      "How many questions refine may ask in this project per rolling 24 hours (0 to 50, default 5); extra ones become assumptions. 0: refine asks none.",
    ),
};

export function registerSettingsTools(
  server: McpServer,
  deps: Pick<ToolDeps, "tracker" | "projects" | "actor" | "email">,
  run: Run,
): void {
  server.registerTool(
    "get_project_settings",
    {
      description:
        "Reads every setting of one project: Builds (buildEnabled, with who turned it on or off and when; set only in the app), auto-build, plan approval, auto-refine, questions per day, auto-merge, agent tasks at once (runsAtOnce), paused, default worker, default executor (actions or local), email notifications (sent only once email is configured: set_email_notifications says), release environments (prod-only or dev-and-prod), and the dispatcher's last decision (lastDispatch: why it is idle, or what it did). Each setting has its own set_* tool except Builds.",
      inputSchema: SettingsInput,
      annotations: { readOnlyHint: true },
    },
    ({ project }) =>
      run(async () => {
        const found = await deps.tracker.getProject(project.toLowerCase());
        if (!found) throw new WorkTrackerError("not_found", `project ${project} not found`);
        return settingsOf(found);
      }),
  );

  // AI-160: the release environment policy; same rule as PATCH /api/projects/{id} (AI-40 parity).
  server.registerTool(
    "set_environments",
    {
      description:
        "Sets a project's release environments: prod-only (default; one prod environment plus PR previews) or dev-and-prod (dev first, then a promote to prod). Only Andy. Nothing deploys from it yet; later M6 slices read it. Logged in the config change log.",
      inputSchema: EnvironmentsInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ project, environments }) =>
      run(async () => {
        const updated = await deps.projects.update(
          project.toLowerCase(),
          { environments },
          { actor: deps.actor, email: deps.email },
        );
        return { project: updated.key, environments: updated.environments };
      }),
  );

  server.registerTool(
    "set_daily_question_cap",
    {
      description:
        "Sets how many questions refine may ask in a project per rolling 24 hours: 0 to 50 (default 5); past it, refine records assumptions instead. Only Andy. Logged in the config change log, as on the settings page.",
      inputSchema: DailyQuestionCapInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ project, dailyQuestionCap }) =>
      run(async () => {
        const updated = await deps.projects.update(
          project.toLowerCase(),
          { dailyQuestionCap },
          { actor: deps.actor, email: deps.email },
        );
        return { project: updated.key, dailyQuestionCap: updated.dailyQuestionCap };
      }),
  );
}
