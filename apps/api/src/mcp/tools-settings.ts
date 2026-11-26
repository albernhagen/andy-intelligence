import {
  DeployKind,
  EnvironmentPolicy,
  PrSync,
  MergeMode,
  Project,
  WorkTrackerError,
} from "@andy/contracts";
import { MERGE_MODE_TEXT, effectiveMergeMode, suggestedMergeMode } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolDeps } from "./tools";

/**
 * Every per-project setting the settings page shows (AI-46), and their setters (environment policy
 * AI-160, deploy kind AI-387, ...). Builds is read here and set only in the app (ADR-0063).
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
  deployKind: p.deployKind,
  prSync: p.prSync,
  // AI-393: when the logo last changed, null for the default mark; `get_project_logo` reads it.
  logoUpdatedAt: p.logoUpdatedAt,
  lastDispatch: p.lastDispatch,
});

const EnvironmentsInput = {
  project: SettingsInput.project,
  environments: EnvironmentPolicy.describe(
    "prod-only (default): one prod environment plus PR previews. dev-and-prod: releases go to dev first, then are promoted to prod.",
  ),
};

// AI-387: how a project ships (ADR-0114). Not a Deployment record's kind (deploy/promote/rollback).
const DeployKindInput = {
  project: SettingsInput.project,
  deployKind: DeployKind.describe(
    "none (default): the project does not deploy. cloud-run: it ships to Cloud Run on GCP, and its environments setting applies.",
  ),
};

// AI-388: which open PRs are kept up to date (ADR-0157).
const PrSyncInput = {
  project: SettingsInput.project,
  prSync: PrSync.describe(
    "queue (default): only the PR next in the merge queue is synced with main, by the queue. all: after each merge the re-sync workflow merges main into every open PR (each one's checks run again).",
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
        "Reads every setting of one project: Builds (buildEnabled, with who turned it on or off and when; set only in the app), auto-build, plan approval, auto-refine, questions per day, merge mode (mergeMode: who merges PRs; null until one is saved, and then nothing merges without Andy; suggestedMergeMode while unset), agent tasks at once (runsAtOnce), paused, default worker, default executor (actions or local), email notifications (sent only once email is configured: set_email_notifications says), release environments (prod-only or dev-and-prod; read only when deployKind is cloud-run), deploy kind (deployKind: none or cloud-run), PR sync (prSync: queue or all), when the logo last changed (logoUpdatedAt, null for the default mark; get_project_logo reads it), and the dispatcher's last decision (lastDispatch: why it is idle, or what it did). Each setting has its own set_* tool except Builds.",
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

  // AI-387: the deploy kind; same rule as PATCH /api/projects/{id} (AI-40 parity).
  server.registerTool(
    "set_deploy_kind",
    {
      description:
        "Sets how a project ships: none (default; it does not deploy) or cloud-run (Cloud Run on GCP). The environments setting is read only while it is cloud-run. Only Andy. Nothing deploys from it yet; later M6 tickets read it. Logged in the config change log.",
      inputSchema: DeployKindInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ project, deployKind }) =>
      run(async () => {
        const updated = await deps.projects.update(
          project.toLowerCase(),
          { deployKind },
          { actor: deps.actor, email: deps.email },
        );
        return { project: updated.key, deployKind: updated.deployKind };
      }),
  );

  // AI-388: PR sync; same rule as PATCH /api/projects/{id} (AI-40 parity).
  server.registerTool(
    "set_pr_sync",
    {
      description:
        "Sets which open PRs are kept up to date with main: queue (default; only the PR next in the merge queue is synced, by the queue, so each merge reruns one PR's checks) or all (after each merge the re-sync workflow merges main into every open PR, ADR-0111). The repo variable RESYNC_PRS still pauses the workflow. Only Andy. Logged in the config change log.",
      inputSchema: PrSyncInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ project, prSync }) =>
      run(async () => {
        const updated = await deps.projects.update(
          project.toLowerCase(),
          { prSync },
          { actor: deps.actor, email: deps.email },
        );
        return { project: updated.key, prSync: updated.prSync };
      }),
  );

  // AI-292: the settings page's "Questions per day"; same rule as PATCH /api/projects/{id}.
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
