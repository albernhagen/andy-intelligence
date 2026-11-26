import { WorkTrackerError, type EventActor, type Ticket, type WorkTracker } from "@andy/contracts";
import {
  type MilestoneReader,
  type MilestoneService,
  DomainError,
  type DigestReader,
  type EmailNotifications,
  type ProjectService,
  type QuotaClearer,
  type BriefService,
  type IdeateService,
  type ProjectPlanService,
  type EpicBreakdownService,
  type ConfigProposals,
  type ConfigRevert,
  type RoutingSettings,
  type RunService,
  type TicketService,
  type WorkReader,
  type RoadmapReader,
  type BoardReader,
  type GlobalSpendCaps,
  type WaitingMergesReader,
  type WhatsNewReader,
  type DigestSummaryService,
  type ProjectTickets,
  type DashboardReader,
  type DoraReader,
  type ReleaseReader,
} from "@andy/domain";
import type { MergeHoldReader, RunnerService } from "@andy/domain";
import type { SetupChecklistReader } from "../setup";
import type { SpendSettingsService } from "../spend";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { NightDeps } from "../night";
import type { PullRequestMerger } from "../merge";
import {
  CROSS_PROJECT_TOOLS,
  projectsOfInput,
  refusedTarget,
  type ProjectAccess,
} from "../project-access";
import * as toolGroups from "./tool-groups";
import type { OnboardingReader } from "../onboarding";

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
  /** Epic breakdowns (AI-383); absent or null: no breakdown tools, none in `list_needs_me`. */
  breakdowns?: EpicBreakdownService | null;
  /** Config proposals from review findings (ADR-0097); absent or null: no config tools. */
  configProposals?: ConfigProposals | null;
  /** The settings change log and revert (M4.12); absent or null: no change-log tools. */
  configRevert?: ConfigRevert | null;
  /** Model routing settings (AI-239); absent or null: no routing tools. */
  routing?: RoutingSettings | null;
  /** Milestones (AI-304); absent or null: no milestone tools. Never in an agent's tool list. */
  milestoneService?: MilestoneService | null;
  /** The night launch step (M4.17); absent or null: no night tools. */
  night?: NightDeps | null;
  /** Work across projects (AI-198); the app always passes it, unit tests may not. */
  work?: WorkReader;
  /** Local runners (ADR-0089); null without a runner store. MCP lists and revokes them (AI-294, AI-351). */
  runners?: RunnerService | null;
  /** Roadmaps over epics (AI-193); the app always passes it, unit tests may not. */
  roadmap?: RoadmapReader;
  /** The board's read (AI-296), shared with GET …/board; the app always passes it. */
  board?: BoardReader;
  /** A project's setup checklist (AI-287); the app always passes it, unit tests may not. */
  setup?: SetupChecklistReader;
  /** A project's onboarding steps (AI-381), in `project_setup`; unit tests may not pass it. */
  onboarding?: OnboardingReader;
  /** Spend caps settings (AI-249); the app always passes it, unit tests may not. */
  spend?: SpendSettingsService;
  /** The global spend caps (AI-276); the app always passes it, unit tests may not. */
  globalSpendCaps?: GlobalSpendCaps;
  /** The Dashboards reads (AI-295); absent: no `dashboard` tool. */
  dashboard?: DashboardReader;
  dora?: DoraReader;
  /** The app's clock (the routes' `now`); absent: the system clock. */
  now?: () => Date;
  /** What's new (AI-159); absent or null: no `whats_new` tool. */
  whatsNew?: WhatsNewReader | null;
  /** Releases (AI-183: M6.9); absent or null: no `list_releases` tool. */
  releases?: ReleaseReader | null;
  /** PRs waiting for Andy's merge (AI-218), in `list_needs_me`; absent or null: none listed. */
  waitingMerges?: WaitingMergesReader | null;
  /** AI-323: the digest's model-written summary; null where it isn't wired. */
  digestSummaries?: DigestSummaryService | null;
  /** The app's public URL for page links in tool text (the digest links What's new); null in dev. */
  publicUrl?: string | null;
  /** Milestones (ADR-0131): `status` shows a ticket's milestone hold (AI-306); null holds any. */
  milestones?: MilestoneReader | null;
  /** A project's tickets through the ticket snapshot (AI-318); absent: a full read each call. */
  tickets?: ProjectTickets;
  /** Merge holds while a default branch is red (AI-382), in `status`; absent or null: none. */
  mergeHolds?: MergeHoldReader | null;
  /** MCP `merge_pr` (AI-220); absent or null: no `merge_pr` tool. */
  merges?: PullRequestMerger | null;
  /** Signed-in email, shown by `status` so it doubles as the connection check. */
  email: string;
  /** The signed-in user as an actor, `user:<uid>` (AI-19): every write is recorded as this. */
  actor: EventActor;
  /** Who may read which project (AI-252: M8.3); the app's one rule, no default. */
  projectAccess: ProjectAccess;
}

/** The app's shared services the tools use: `ToolDeps` without the caller. */
export type ToolServices = Omit<ToolDeps, "email" | "actor" | "projectAccess">;

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
  const checked = withProjectAccess(server, deps.projectAccess, deps.actor);
  for (const register of Object.values(groups)) register(checked, deps, run);
}

type ToolCallback = (...args: unknown[]) => unknown;

/**
 * The server every tool group registers on (AI-252: M8.3). Before a handler runs, every project
 * its input names (`project`, and each ticket key's prefix) is checked; a refusal is the same "not
 * found" an unknown one gets. A call that names no project runs only for a tool listed in
 * `CROSS_PROJECT_TOOLS`; any other is refused (fail closed).
 */
export function withProjectAccess(
  server: McpServer,
  access: ProjectAccess,
  actor: EventActor,
): McpServer {
  const checked = Object.create(server) as McpServer;
  const register = server.registerTool.bind(server) as (
    name: string,
    config: { inputSchema?: unknown },
    cb: ToolCallback,
  ) => unknown;
  const guarded = (name: string, config: { inputSchema?: unknown }, cb: ToolCallback) =>
    // A tool without input gets only `extra`; one with input gets its parsed args first.
    register(name, config, async (...callArgs: unknown[]) => {
      const targets = config.inputSchema ? projectsOfInput(callArgs[0]) : [];
      if (targets.length === 0 && !(name in CROSS_PROJECT_TOOLS)) {
        console.error(
          JSON.stringify({
            severity: "ERROR",
            component: "project-access",
            message: "tool has no project scope",
            tool: name,
            actor,
          }),
        );
        return refuse("not found");
      }
      const refused = await refusedTarget(access, actor, targets);
      return refused ? refuse(refused.error) : cb(...callArgs);
    });
  checked.registerTool = guarded as unknown as McpServer["registerTool"];
  return checked;
}

const refuse = (error: string) =>
  run(() => Promise.reject(new WorkTrackerError("not_found", error)));

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
