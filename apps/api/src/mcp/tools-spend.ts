import { Project, ProjectSpendCaps } from "@andy/contracts";
import { formatMicroUsd, type SpendView } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Run, ToolDeps } from "./tools";

/**
 * Spend caps settings (AI-249: M10.8), the same rules as `GET`/`PUT /api/projects/{id}/spend`
 * and the settings page (AI-40 parity): reading shows caps and spend so far; setting a project's
 * caps is Andy's, refused above the global caps, and logged in the config change log.
 */

const ProjectKey = z
  .string()
  .transform((k) => k.trim().toUpperCase())
  .pipe(Project.shape.key)
  .describe('Project key, e.g. "AI".');

const cap = (what: string) =>
  ProjectSpendCaps.shape.dailyMicroUsd.describe(
    `The project's ${what} cap in micro-dollars (1 USD = 1,000,000; whole numbers only). Left out: unchanged. null: take the global cap. Must not be above the global cap.`,
  );

const SetSpendCapsInput = {
  project: ProjectKey,
  dailyMicroUsd: cap("daily"),
  monthlyMicroUsd: cap("monthly"),
  perTaskMicroUsd: cap("per-task"),
  reason: z.string().max(500).optional().describe("Why; kept in the config change log."),
};

/** The view with dollar amounts beside the micro-dollars, so a reader needn't convert. */
function shown(project: string, v: SpendView) {
  const usd = (n: number) => formatMicroUsd(n);
  return {
    project,
    globalCaps: { ...v.global.caps, source: v.global.source },
    projectCaps: v.project,
    effective: v.effective,
    effectiveUsd: Object.fromEntries(Object.entries(v.effective).map(([k, n]) => [k, usd(n)])),
    spent: v.spent ?? "unknown",
    spentUsd: v.spent
      ? {
          projectToday: usd(v.spent.project.dayMicroUsd),
          projectThisMonth: usd(v.spent.project.monthMicroUsd),
          allProjectsToday: usd(v.spent.global.dayMicroUsd),
          allProjectsThisMonth: usd(v.spent.global.monthMicroUsd),
        }
      : "unknown",
  };
}

export function registerSpendTools(server: McpServer, deps: ToolDeps, run: Run): void {
  const spend = deps.spend;
  if (!spend) return;

  server.registerTool(
    "get_spend",
    {
      description:
        "A project's spend caps and what it spent: the global caps (code defaults until they can be edited), the project's own caps, the effective caps a paid call is checked against, and spend today and this month for the project and all projects (\"unknown\" when the spend ledger can't be read, never zero). Amounts in micro-dollars (1 USD = 1,000,000), with dollar strings beside them.",
      inputSchema: { project: ProjectKey },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ project }) => run(async () => shown(project, await spend.view(project.toLowerCase()))),
  );

  server.registerTool(
    "set_spend_caps",
    {
      description:
        "Sets a project's own spend caps (daily, monthly, per-task) in micro-dollars; a cap left out stays as it is, null takes the global cap, and each must be at or below the global cap. Andy only. Refused, with the reason, if a cap is above the global one. Lowering is always allowed. Logged in the config change log and revertable there. Two calls at the same moment can each keep only their own cap (the second write wins): set the caps in one call, or check with get_spend after. Nothing spends money from this.",
      inputSchema: SetSpendCapsInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ project, reason, ...caps }) =>
      run(async () =>
        shown(
          project,
          await spend.set(
            project.toLowerCase(),
            { caps, ...(reason === undefined ? {} : { reason }) },
            { actor: deps.actor, email: deps.email },
          ),
        ),
      ),
  );
}
