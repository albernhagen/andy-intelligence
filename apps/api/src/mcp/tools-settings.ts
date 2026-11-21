import { EnvironmentPolicy, MergeMode, Project, WorkTrackerError } from "@andy/contracts";
import { MERGE_MODE_TEXT, effectiveMergeMode, suggestedMergeMode } from "@andy/domain";
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
  // ADR-0124, ADR-0134: the saved mode (null: none, so the gate merges nothing) and the one
  // ADR-0124's mapping suggests until one is saved.
  mergeMode: p.mergeMode,
  suggestedMergeMode: p.mergeMode === null ? suggestedMergeMode(p) : null,
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

const MergeModeInput = {
  project: SettingsInput.project,
  mode: MergeMode.describe(
    `Strictest first. ${MergeMode.options.map((m) => `${m}: ${MERGE_MODE_TEXT[m]}`).join(" ")}`,
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
        "Reads every setting of one project: Builds (buildEnabled, with who turned it on or off and when; set only in the app), auto-build, plan approval, auto-refine, questions per day, merge mode (mergeMode: who merges PRs; null until one is saved, and then nothing merges without Andy; suggestedMergeMode while unset), agent tasks at once (runsAtOnce), paused, default worker, default executor (actions or local), email notifications (sent only once email is configured: set_email_notifications says), release environments (prod-only or dev-and-prod), and the dispatcher's last decision (lastDispatch: why it is idle, or what it did). Each setting has its own set_* tool except Builds.",
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

  // ADR-0124: merge modes. Tighten only over MCP; loosening is done on the settings page.
  server.registerTool(
    "set_merge_mode",
    {
      description:
        "Sets a project's merge mode (who merges its PRs, ADR-0124), strictest first: manual, epic, low-risk, all-clean. Only Andy, and over MCP only to the same or a stricter mode: loosening is refused, change it on the project settings page. With no mode saved the gate merges nothing, so over MCP only manual can be saved then (ADR-0134). Logged in the config change log.",
      inputSchema: MergeModeInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ project, mode }) =>
      run(async () => {
        const updated = await deps.projects.tightenMergeMode(project.toLowerCase(), mode, {
          actor: deps.actor,
          email: deps.email,
        });
        return { project: updated.key, mergeMode: effectiveMergeMode(updated) };
      }),
  );
}
