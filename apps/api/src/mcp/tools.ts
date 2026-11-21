import { WorkTrackerError, type EventActor, type Ticket, type WorkTracker } from "@andy/contracts";
import {
  DomainError,
  type DigestReader,
  type EmailNotifications,
  type ProjectService,
  type QuotaClearer,
  type BriefService,
  type IdeateService,
  type ProjectPlanService,
  type ConfigProposals,
  type ConfigRevert,
  type RunService,
  type TicketService,
  type WorkReader,
} from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { NightDeps } from "../night";
import * as toolGroups from "./tool-groups";

/**
 * MCP tools: thin adapters over TicketService, RunService and the other domain services, the
 * same rules the REST API and UI use. Every caller passed the allow-list and acts as
 * `deps.actor` (`user:<uid>`, AI-19); owner-only rules decide through `can`. Each `tools-*.ts`
 * module registers its own tools and has one line in `tool-groups.ts` (AI-145).
 */

export interface ToolDeps {
  tracker: WorkTracker;
  service: TicketService;
  runs: RunService;
  projects: ProjectService;
  /** The daily digest (AI-70); the app always passes it, unit tests may not. */
  digest?: DigestReader;
  /** Needs-you email (AI-77); null or absent: not configured. */
  notifyEmail?: EmailNotifications | null;
  /** Clears a quota idle (AI-74); the app always passes it, unit tests may not. */
  quota?: QuotaClearer;
  /** The project brief's write (AI-107); the app always passes it, unit tests may not. */
  brief?: BriefService;
  /** Ideation (AI-114); the app always passes it, unit tests may not. */
  ideate?: IdeateService;
  /** Project plans (AI-108); the app always passes it, unit tests may not. */
  plans?: ProjectPlanService;
  /** Config proposals from review findings (ADR-0097); absent or null: no config tools. */
  configProposals?: ConfigProposals | null;
  /** The settings change log and revert (M4.12); absent or null: no change-log tools. */
  configRevert?: ConfigRevert | null;
  /** The night launch step (M4.17); absent or null: no night tools. */
  night?: NightDeps | null;
  /** Work across projects (AI-198); the app always passes it, unit tests may not. */
  work?: WorkReader;
  /** Signed-in email, shown by `status` so it doubles as the connection check. */
  email: string;
  /** The signed-in user as an actor, `user:<uid>` (AI-19): every write is recorded as this. */
  actor: EventActor;
}

/** The app's shared services the tools use: `ToolDeps` without the caller. */
export type ToolServices = Omit<ToolDeps, "email" | "actor">;

/** Wraps a tool's work into an MCP result: `run` below. */
export type Run = <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>;

/** A tool module's registration; each `tools-*.ts` exports one, listed in `tool-groups.ts`. */
export type ToolGroup = (server: McpServer, deps: ToolDeps, run: Run) => void;

export const summary = (t: Ticket) => ({
  key: t.key,
  title: t.title,
  type: t.type,
  stage: t.stage,
  dorStatus: t.dorStatus,
  needsAttention: t.needsAttention,
  archived: t.archived,
});

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const groups: Record<string, ToolGroup> = toolGroups;
  for (const register of Object.values(groups)) register(server, deps, run);
}

/**
 * Rule violations and not-found/conflict come back as tool errors Claude can read and act on.
 * Anything else is logged and hidden behind "internal error", as the REST API does.
 */
export async function run<T extends object>(fn: () => Promise<T>): Promise<CallToolResult> {
  try {
    const value = await fn();
    return {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      structuredContent: value as Record<string, unknown>,
    };
  } catch (err) {
    if (err instanceof DomainError || err instanceof WorkTrackerError) {
      const details = err instanceof DomainError && err.details.length > 0;
      const text = details ? `${err.message}: ${err.details.join(", ")}` : err.message;
      return { isError: true, content: [{ type: "text", text }] };
    }
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(
      JSON.stringify({
        severity: "ERROR",
        component: "mcp-tools",
        message: error.message,
        stack: error.stack,
      }),
    );
    return { isError: true, content: [{ type: "text", text: "internal error" }] };
  }
}
