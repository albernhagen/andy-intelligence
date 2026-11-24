# Web UI and MCP parity — inventory

Step 1 of AI-285: Web UI and MCP parity: every action in both, enforced by a test. Taken from `main` at `8a635f1` on 2026-11-21: the 79 signed-in `/api/*` routes and 62 MCP tools (`pnpm --filter @andy/api snapshot`), and every route the web calls (`apps/web/src`). **Parity** means Andy can do the same thing in the web UI and from Claude over MCP. Nothing here is built yet; Andy reviews the list first. Gaps in parked milestones (M6: Dev → prod releases, M7: Mobile, M8: Project members, M9: Add Jules + model routing) are listed apart and get no tickets.

## Matched: in both

| Action                                                   | Web route(s)                                                                    | MCP tool(s)                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Needs-you inbox; answer a question                       | `GET /needs-you`, `POST /questions/:id/answer`                                  | `list_needs_me`, `answer_question`                                                                                         |
| Approve or reject an agent's plan                        | `POST …/runs/:id/plan-decision`                                                 | `approve_plan`, `reject_plan`                                                                                              |
| Project plan: read, decide                               | `GET …/plan`, `GET /project-plans/waiting`, `POST …/plan/decision`              | `list_needs_me`, `approve_project_plan`, `reject_project_plan`                                                             |
| Ticket: create, read, edit, parent, comment, ask         | `POST …/tickets`, `GET /tickets/:key`, `…/readiness`, `…/questions`, `PATCH …`  | `create_ticket`, `status`, `edit_ticket`, `set_ticket_parent`, `comment_ticket`, `ask_question`                            |
| Ticket: move, rank, Up next, cancel, archive             | `POST …/stage`, `…/up-next`, `…/cancel`, `…/archive`, `PATCH` rank              | `move_ticket`, `reorder_ticket`, `cancel_ticket`, `archive_ticket`                                                         |
| Assumptions                                              | `POST …/assumptions/:id/accept`, `…/promote`                                    | `accept_assumption`, `promote_assumption`                                                                                  |
| Epic tickets and progress                                 | `GET …/tickets/:id/epic`                                                        | `status` (epic key)                                                                                                        |
| Start refine or build                                    | `POST …/tickets/:id/runs`                                                       | `refine`, `build`                                                                                                          |
| Worker and executor                                      | `GET`/`PUT …/worker`, `…/executor`                                              | `status`, `set_worker`, `set_executor`                                                                                     |
| Ticket history and agent tasks (paged on MCP)            | `…/tickets/:id/events`, `…/tickets/:id/runs`, `…/runs/:runId`                   | `ticket_history`, `list_runs`, `get_run` (AI-293)                                                                          |
| Which layer set worker, tier, route                      | `GET …/tickets/:id/routing`                                                     | `status` (`routing`) (AI-282, PR #301)                                                                                     |
| Night launch, its status, stop; the morning report       | `GET`/`POST …/night`, `POST …/night/stop`; report arrives as an epic comment    | `night_status`, `launch_night`, `stop_night`; report in `status` and `list_needs_me`                                       |
| In flight; work across projects; digest                  | `GET …/in-flight`, `GET /work`, `GET …/digest`                                  | `list_in_flight`, `list_work`, `digest`                                                                                    |
| Retry the digest summary (AI-323)                        | `POST …/digest/summary/retry`                                                   | `retry_digest_summary`                                                                                                     |
| Dashboards; DORA metrics                                 | `GET /dashboard`, `…/dashboard`, `…/dora`                                       | `dashboard` (AI-295)                                                                                                       |
| Project list; settings (except below)                    | `GET /projects`, `GET`/`PATCH /projects/:id`                                    | `list_projects`, `get_project_settings`, the `set_*` tools, `set_spend_caps`                                               |
| Project setup checklist | `GET …/setup` | `project_setup` (AI-287) |
| The board, every stage | `GET …/board` | `board` (AI-296) |
| Roadmap of milestones; milestone map | `GET /roadmap`, `…/roadmap` (AI-202 screen) | `roadmap`; `milestone_map` (MCP only) |
| Create a project | `POST /projects` | `create_project` (AI-297) |
| Milestones: list, create, edit, set status, attach an epic | `GET`/`POST …/milestones`, `PATCH …/milestones/:id`, `PUT …/tickets/:id/milestone` (AI-311: epic panel, roadmap, board) | `list_milestones`, `create_milestone`, `edit_milestone`, `set_milestone_status`, `set_epic_milestone` (AI-304) |
| List local runners | `GET /runners` | `list_runners` (AI-294) |
| Revoke a local runner | `POST /runners/:id/revoke` | `revoke_runner`, owner only (AI-351, ADR-0143) |
| Settings changes: list, revert                           | `GET …/config-changes`, `POST …/config-changes/:id/revert`                      | `list_settings_changes`, `revert_settings_change`                                                                          |
| Config proposals: list, accept, reject, sweep            | `GET /config-changes`, `POST …/accept`, `…/reject`, `…/config-proposals/sweep`  | `list_config_changes`, `accept_config_change`, `reject_config_change`, `sweep_config_proposals`                            |
| Pause, runs at once                                      | `PATCH /projects/:id`                                                           | `set_paused`, `set_runs_at_once`                                                                                           |
| Needs-you email: configured?, test send | `GET /notify/email`, `POST /notify/email/test` | `set_email_notifications` and `test_email` (AI-289) report `emailConfigured`; today's count and cap are web-only |
| Quota: read, clear idle | `GET /quota`, `POST /quota/clear` | `get_quota` (AI-286), `clear_quota_idle` |
| Spend caps: read, set, history, revert (project, global) | `GET …/spend`, `PUT …/spend-caps`, `GET`/`PUT /spend-caps`, `…/changes`, revert | `get_spend`, `set_spend_caps`, `set_global_spend_caps`, `list_spend_cap_changes`, `revert_spend_cap_change`                |
| Spend per provider | `GET …/spend/providers` | `get_spend` (`byProvider`, AI-288) |
| Routing: read, edit (global, project), history, revert   | `GET`/`PUT /routing`, `PUT …/routing`, `GET /routing/changes`, revert           | `get_routing`, `set_tier_routes`, `set_provider_routing`, `set_step_tier`, `list_routing_changes`, `revert_routing_change` |
| Who am I                                                 | `GET /me`                                                                       | `status` (`signedInAs`)                                                                                                    |
| Ranked Ready list with scores and filters | The board's Ready lane filters (AI-343); `GET …/ready` | `list_ready` |

## Gaps and their tickets (smallest first)

| Ticket                                                                 | Direction | Size | Missing side                                                 |
| ---------------------------------------------------------------------- | --------- | ---- | ------------------------------------------------------------ |
| AI-290: Parity: ask a question on a ticket over MCP                    | done      | S    | `POST …/tickets/:id/questions` → `ask_question`              |
| AI-291: Parity: edit_ticket sets needs-attention, risk and confidence  | done      | S    | `PATCH` fields → `edit_ticket`                               |
| AI-292: Parity: set the daily question cap over MCP                    | done      | S    | `PATCH dailyQuestionCap` → `set_daily_question_cap`          |
| AI-293: Parity: a ticket's full history and runs over MCP              | done      | S    | Built: `ticket_history`, `list_runs`, `get_run` (now matched) |
| AI-294: Parity: list runners over MCP | done | S | Built: `list_runners` (ADR-0135; now matched) |
| AI-351: Parity: revoke a runner over MCP | done | S | Built: `revoke_runner`, owner only (ADR-0143; now matched) |
| AI-295: Parity: dashboards and DORA metrics over MCP                   | UI-only   | S    | Built: `dashboard` (now matched)                             |
| AI-296: Parity: the board, every stage, over MCP | UI-only | S | Built: `board` (now matched) |
| AI-321: Milestone create and edit over MCP | done | S | Built: `create_milestone`, `edit_milestone` (ADR-0136, proposed; now matched) |
| AI-298: Parity: ranked Ready list in the web UI                        | MCP-only  | S    | Built: `GET …/ready` and the Ready view (now matched)        |
| AI-299: Parity: ideate from the web UI                                 | MCP-only  | M    | Built: the board's Ideate form starts an ideate agent task (now matched) |
| AI-300: Parity: registry test that every action has a route and a tool | done | M | Built: `apps/api/src/parity.ts` and `parity.test.ts` |

## Gaps owned elsewhere

| Action                      | Today                      | Where                                                                                             |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| Merge a gated PR            | Neither (Andy uses GitHub) | AI-220: Merge modes: coordinator sessions merge through MCP merge_pr; the web links to GitHub     |
| What's new (release notes)  | Neither                    | AI-159: What's new (page and `whats_new` tool; PR #234 open)                                      |

## Parked (no tickets)

None. The one parked row, which layer set worker, tier and route, shipped in both with AI-282 (PR #301) and is listed as matched.

M6, M7 and M8 add no gap today: their settings that exist (environments) are already in both.

## One side on purpose (the parity test records the reason)

The registry `apps/api/src/parity.ts` (AI-300) holds every action with its routes and tools; `parity.test.ts` fails when a route or tool is in no action, names one that doesn't exist, or has one side without a reason. No open gaps today (AI-351 matched revoking a runner). AI-320 matched starting the plan-project and ideate agent tasks: `start_plan_project` and `start_ideate` over MCP; in the web, the Project plan card's button and the board's Ideate form (AI-299).

| Action                                                | Side     | Reason                                                                                                   |
| ----------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Turn Builds on or off                                 | Web only | ADR-0063: Builds is set only in the app                                                                  |
| Register a runner                                     | Web only | Returns the runner token once; a token should not land in a chat transcript                              |
| OAuth consent (`POST /oauth/approve`)                 | Web only | The browser half of MCP sign-in                                                                          |
| GitHub App setup (`/github`, `/manifest`, `/connect`) | Web only | GitHub's manifest flow needs a browser                                                                   |
| `submit_brief`, `submit_project_plan`                 | MCP only | Written by a Claude session following `onboard.md` and `plan-project.md`; the web shows and decides them |

Not covered here: step 4 of AI-285 (refreshing a long-lived Claude session's tool list) has no ticket yet.
