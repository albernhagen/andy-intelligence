/**
 * Web UI and MCP parity registry (AI-300, epic AI-285; inventory:
 * `docs/architecture/ui-mcp-parity.md`). One entry per user action: the signed-in `/api` routes
 * the web calls and the MCP tools Claude calls for it. `parity.test.ts` fails when a route or a
 * tool is in no entry, when an entry names one that doesn't exist, or when an entry with only one
 * side gives no reason. Routes are `METHOD path` as Hono registers them (`:param`).
 *
 * Adding a route or a tool? Add it to its action here, or add the action. Only one side on
 * purpose? Say why in `oneSide`. Not built yet? Name the open ticket in `pending`.
 */

export interface ParityEntry {
  action: string;
  routes: readonly string[];
  tools: readonly string[];
  /** Required when `routes` or `tools` is empty: why this action has only one side. */
  oneSide?: string;
  /** An open ticket that closes a gap in this action, with what is missing. */
  pending?: { ticket: `AI-${number}`; missing: string };
  /** Field-level exceptions the route-and-tool check can't see. */
  note?: string;
}

const P = "/api/projects/:projectId";
const T = `${P}/tickets/:ticketId`;

export const PARITY: readonly ParityEntry[] = [
  {
    action: "Needs-you inbox; answer a question",
    routes: ["GET /api/needs-you", "POST /api/questions/:questionId/answer"],
    tools: ["list_needs_me", "answer_question"],
  },
  {
    action: "Approve or reject an agent's plan",
    routes: [`POST ${T}/runs/:runId/plan-decision`],
    tools: ["approve_plan", "reject_plan"],
  },
  {
    action: "Project plan: submit, read, decide",
    routes: [
      `POST ${P}/plan`,
      `GET ${P}/plan`,
      "GET /api/project-plans/waiting",
      `POST ${P}/plan/decision`,
    ],
    tools: ["submit_project_plan", "list_needs_me", "approve_project_plan", "reject_project_plan"],
    note: "A Claude session writes the plan (plan-project.md); the web shows and decides it.",
  },
  {
    action: "Project brief: submit",
    routes: [`POST ${P}/brief`],
    tools: ["submit_brief"],
    note: "A Claude session writes the brief (onboard.md); the web shows it.",
  },
  {
    action: "Ticket: create, list, read, edit, parent, comment, ask a question",
    routes: [
      `POST ${P}/tickets`,
      `GET ${P}/tickets`,
      `GET ${T}`,
      "GET /api/tickets/:key",
      `GET ${T}/readiness`,
      `GET ${T}/questions`,
      `POST ${T}/questions`,
      `PATCH ${T}`,
      `POST ${T}/comments`,
    ],
    tools: [
      "create_ticket",
      "status",
      "list_work",
      "edit_ticket",
      "set_ticket_parent",
      "comment_ticket",
      "ask_question",
    ],
  },
  {
    action: "Ticket: move, rank, Up next, cancel, archive",
    routes: [`POST ${T}/stage`, `POST ${T}/up-next`, `POST ${T}/cancel`, `POST ${T}/archive`],
    tools: ["move_ticket", "reorder_ticket", "cancel_ticket", "archive_ticket"],
  },
  {
    action: "Assumptions: accept, promote",
    routes: [
      `POST ${T}/assumptions/:assumptionId/accept`,
      `POST ${T}/assumptions/:assumptionId/promote`,
    ],
    tools: ["accept_assumption", "promote_assumption"],
  },
  {
    action: "Epic: its tickets and progress",
    routes: [`GET ${T}/epic`],
    tools: ["status"],
  },
  {
    action: "Start refine or build",
    routes: [`POST ${T}/runs`],
    tools: ["refine", "build"],
  },
  {
    action: "Worker and executor",
    routes: [`GET ${T}/worker`, `PUT ${T}/worker`, `GET ${T}/executor`, `PUT ${T}/executor`],
    tools: ["status", "set_worker", "set_executor"],
  },
  {
    action: "Ticket history and agent tasks",
    routes: [`GET ${T}/events`, `GET ${T}/runs`, `GET ${P}/runs/:runId`],
    tools: ["ticket_history", "list_runs", "get_run"],
  },
  {
    action: "Which layer set worker, tier and route",
    routes: [`GET ${T}/routing`],
    tools: ["status"],
  },
  {
    action: "Night launch, its status, stop",
    routes: [`GET ${T}/night`, `POST ${T}/night`, `POST ${T}/night/stop`],
    tools: ["night_status", "launch_night", "stop_night"],
  },
  {
    action: "In flight; work across projects; digest",
    routes: [`GET ${P}/in-flight`, "GET /api/work", `GET ${P}/digest`],
    tools: ["list_in_flight", "list_work", "digest"],
  },
  {
    action: "Dashboards; DORA metrics",
    routes: ["GET /api/dashboard", `GET ${P}/dashboard`, `GET ${P}/dora`],
    tools: ["dashboard"],
  },
  {
    action: "Project list and settings",
    routes: ["GET /api/projects", `GET ${P}`, `PATCH ${P}`],
    tools: [
      "list_projects",
      "get_project_settings",
      "set_auto_build",
      "set_auto_merge",
      "set_auto_refine",
      "set_daily_question_cap",
      "set_default_executor",
      "set_default_worker",
      "set_email_notifications",
      "set_environments",
      "set_merge_mode",
      "set_paused",
      "set_plan_approval",
      "set_runs_at_once",
    ],
    note: "Except Builds: web only, ADR-0063 (Builds is set only in the app).",
  },
  {
    action: "Project setup checklist",
    routes: [`GET ${P}/setup`],
    tools: ["project_setup"],
  },
  {
    action: "Create a project",
    routes: ["POST /api/projects"],
    tools: ["create_project"],
  },
  {
    action: "Settings changes: list, revert",
    routes: [`GET ${P}/config-changes`, `POST ${P}/config-changes/:changeId/revert`],
    tools: ["list_settings_changes", "revert_settings_change"],
  },
  {
    action: "Config proposals: list, accept, reject, sweep",
    routes: [
      "GET /api/config-changes",
      "POST /api/config-changes/:changeId/accept",
      "POST /api/config-changes/:changeId/reject",
      `POST ${P}/config-proposals/sweep`,
    ],
    tools: [
      "list_config_changes",
      "accept_config_change",
      "reject_config_change",
      "sweep_config_proposals",
    ],
  },
  {
    action: "Needs-you email: configured?, test send",
    routes: ["GET /api/notify/email", "POST /api/notify/email/test"],
    tools: ["set_email_notifications", "test_email"],
    note: "Today's count and the cap are web only; MCP reports whether email is configured.",
  },
  {
    action: "Quota: read, clear idle",
    routes: ["GET /api/quota", "POST /api/quota/clear"],
    tools: ["get_quota", "clear_quota_idle"],
  },
  {
    action: "Spend: caps and spend (project, global, per provider), history, revert",
    routes: [
      `GET ${P}/spend`,
      `GET ${P}/spend/providers`,
      `PUT ${P}/spend-caps`,
      "GET /api/spend-caps",
      "PUT /api/spend-caps",
      "GET /api/spend-caps/changes",
      "POST /api/spend-caps/changes/:changeId/revert",
    ],
    tools: [
      "get_spend",
      "set_spend_caps",
      "set_global_spend_caps",
      "list_spend_cap_changes",
      "revert_spend_cap_change",
    ],
  },
  {
    action: "Routing: read, edit (global, project), history, revert",
    routes: [
      "GET /api/routing",
      "PUT /api/routing",
      `PUT ${P}/routing`,
      "GET /api/routing/changes",
      "POST /api/routing/changes/:changeId/revert",
    ],
    tools: [
      "get_routing",
      "set_tier_routes",
      "set_provider_routing",
      "set_step_tier",
      "list_routing_changes",
      "revert_routing_change",
    ],
  },
  {
    action: "Who am I",
    routes: ["GET /api/me"],
    tools: ["status"],
  },
  {
    action: "Ranked Ready list",
    routes: [`GET ${P}/ready`],
    tools: ["list_ready"],
  },
  {
    action: "Roadmap; milestone map",
    routes: ["GET /api/roadmap", `GET ${P}/roadmap`, `GET ${P}/milestone-map`],
    tools: ["roadmap", "milestone_map"],
  },
  {
    action: "What's new",
    routes: [`GET ${P}/whats-new`],
    tools: ["whats_new"],
  },
  {
    action: "Ideate",
    routes: [`POST ${P}/ideate`],
    tools: ["ideate"],
    pending: {
      ticket: "AI-299",
      missing: "a web form: the route exists but the web never calls it (PR #240)",
    },
  },
  {
    action: "Milestones: list, set status, attach or detach an epic",
    routes: [`GET ${P}/milestones`, `PATCH ${P}/milestones/:milestoneId`, `PUT ${T}/milestone`],
    tools: ["list_milestones", "set_milestone_status", "set_epic_milestone"],
    note: "PATCH also renames, rewords and reorders: web only today (see Create a milestone).",
  },
  // ── One side on purpose ─────────────────────────────────────────────────────
  {
    action: "Register a runner",
    routes: ["POST /api/runners"],
    tools: [],
    oneSide: "Returns the runner secret once; a secret must not land in a chat transcript.",
  },
  {
    action: "OAuth consent",
    routes: ["POST /api/oauth/approve"],
    tools: [],
    oneSide: "The browser half of MCP sign-in.",
  },
  {
    action: "GitHub App setup",
    routes: ["GET /api/github", "GET /api/github/manifest", "POST /api/github/connect"],
    tools: [],
    oneSide: "GitHub's manifest flow needs a browser.",
  },
  {
    action: "Create a milestone",
    routes: [`POST ${P}/milestones`],
    tools: [],
    oneSide: "ADR-0131 names three MCP milestone tools: list, set status, attach an epic.",
  },
  // ── Open gaps, each with its ticket ─────────────────────────────────────────
  {
    action: "List and revoke runners",
    routes: ["GET /api/runners", "POST /api/runners/:runnerId/revoke"],
    tools: [],
    oneSide: "Web only until Andy decides on amending ADR-0089 (runner credentials).",
    pending: { ticket: "AI-294", missing: "list_runners and revoke_runner (PR #327, held)" },
  },
  {
    action: "The board, every stage",
    routes: [`GET ${P}/board`],
    tools: ["board"],
  },
];
