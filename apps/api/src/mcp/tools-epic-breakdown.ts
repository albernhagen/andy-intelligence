import {
  BREAKDOWN_LIMITS,
  EpicBreakdownProposal,
  TicketKey,
  type EventActor,
} from "@andy/contracts";
import type { EpicBreakdownService, RunService } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * MCP tools for epic breakdowns (AI-383, ADR-0155); the UI and REST API have the same controls
 * (`epic-breakdown.ts`). `list_needs_me` lists waiting ones as `epicBreakdowns`.
 */

interface EpicBreakdownToolDeps {
  breakdowns?: EpicBreakdownService | null;
  runs: Pick<RunService, "requestEpicTask">;
  actor: EventActor;
}

type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

const EpicKey = z
  .string()
  .transform((k) => k.trim().toUpperCase())
  .pipe(TicketKey)
  .describe('The top-level epic\'s key, e.g. "TRL-3".');
const projectOf = (key: string) => key.split("-")[0]!.toLowerCase();

export function registerEpicBreakdownTools(
  server: McpServer,
  deps: EpicBreakdownToolDeps,
  run: Run,
): void {
  const breakdowns = deps.breakdowns;
  if (!breakdowns) return;

  server.registerTool(
    "start_epic_breakdown",
    {
      description: `Owner only. Starts a plan-epic agent task on a top-level epic in an approved milestone: an agent reads the repo read-only, follows platform/procedures/plan-epic.md and stores up to ${BREAKDOWN_LIMITS.tickets} drafted child tickets as a proposal for Andy (Needs-you); no ticket is created yet (about 10-40 minutes). Spends Claude quota. Refused, with the reason, when the milestone isn't approved, a breakdown waits or was approved, a task for the epic is in flight, the epic used its ${BREAKDOWN_LIMITS.draftsPerEpic} drafting tasks, at the agent-tasks-at-once dial or the cap across projects, or without a repo or GitHub connection.`,
      inputSchema: { ticket: EpicKey },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ ticket }) => run(() => deps.runs.requestEpicTask(projectOf(ticket), ticket, deps.actor)),
  );

  server.registerTool(
    "submit_epic_breakdown",
    {
      description:
        "Owner only. Stores a top-level epic's drafted child tickets (the result of platform/procedures/plan-epic.md: summary and tickets in build order, blockedBy as 0-based sibling indexes) as a proposal for Andy. Creates no tickets. Refused under the same rules as start_epic_breakdown's epic checks.",
      inputSchema: { ticket: EpicKey, breakdown: EpicBreakdownProposal },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ ticket, breakdown }) =>
      run(() => breakdowns.propose(projectOf(ticket), ticket, breakdown, deps.actor)),
  );

  server.registerTool(
    "approve_epic_breakdown",
    {
      description:
        "Owner only. Approves the epic's waiting breakdown: creates its drafted tickets under the epic in Ideas, in order, with type, size, acceptance criteria, touches and blockers set to the created keys. Starts no build. Approving again after a failure resumes without duplicates.",
      inputSchema: { ticket: EpicKey },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ ticket }) =>
      run(() => breakdowns.decide(projectOf(ticket), ticket, { decision: "approved" }, deps.actor)),
  );

  server.registerTool(
    "reject_epic_breakdown",
    {
      description:
        "Owner only. Sends the epic's waiting breakdown back with a note; no tickets are created. The next drafting task reads the note.",
      inputSchema: {
        ticket: EpicKey,
        reason: z
          .string()
          .trim()
          .min(1)
          .max(BREAKDOWN_LIMITS.reason)
          .describe("What to change, for the next draft."),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ ticket, reason }) =>
      run(() =>
        breakdowns.decide(projectOf(ticket), ticket, { decision: "rejected", reason }, deps.actor),
      ),
  );
}
