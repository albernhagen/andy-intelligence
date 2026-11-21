# Threat model: Project access

One check decides whether a caller may read a project, for API routes and MCP tools alike (AI-252: M8.3: One project-access check for API routes and MCP tools). Risk: [R-AI-252](risks/R-AI-252.md). Code: `apps/api/src/project-access.ts`.

## Where the check runs

| Entry                                                                                                                               | Project it reads              | Refusal                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/api/projects/{projectId}[/…]` (every method)                                                                                      | `projectId`                   | `404 {"error":"project not found"}`, the same body as an unknown project                                             |
| `/api/tickets/{KEY}`                                                                                                                | The key's prefix, lowercased  | `404 {"error":"ticket not found: KEY"}`, as an unknown ticket                                                        |
| `/api` query `project` or `projectId` (`/api/work`, `/api/routing`)                                                                 | the value                     | `404 {"error":"project not found"}`                                                                                  |
| JSON body of an `/api` write: `project`, and ticket keys in `ticket`, `parent`, `parentId`, `blockedBy`, `above`, `below` or `epic` | `project`; each key's prefix  | `404` with that one's unknown body (e.g. `ticket not found: OPS-9`, as an unknown blocker today); nothing is written |
| MCP tool with a `project` input (required or given)                                                                                 | `project`, lowercased         | Tool error `project KEY not found`; the handler doesn't run                                                          |
| MCP tool with a ticket key in `ticket`, `parent`, `parentId`, `blockedBy`, `above`, `below` or `epic`                               | Each key's prefix, lowercased | Tool error `ticket not found: KEY`; the handler doesn't run                                                          |

- Order on `/api/*`: sign-in and allow-list (401, 403), body cap, then this check. Strangers never reach it, so a refusal can't tell them a project exists.
- Each refusal logs a `WARNING` with the actor (`user:<uid>`) and project id; never the email (ADR-0015).
- Never 403: a project you can't read looks like one that doesn't exist.
- **Fail closed:** an `/api` route with no project in its path runs only if listed in `CROSS_PROJECT_ROUTES`, and an MCP call naming no project only for a tool in `CROSS_PROJECT_TOOLS` (both in `project-access.ts`). Anything else gets `404 not found` and an `ERROR` log; `registries.test.ts` fails on it first.
- HEAD matches as GET (Hono answers it with the GET handler). A write's body is parsed as JSON whatever its content type, so no header hides its keys.
- A ticket id (not a key) in a body only ever resolves in the path's own project, so it names nothing new.

## Today

`ownerOnlyAccess()`: every allow-listed caller is the owner and reads every project, so nothing changes. `projectAccess` is a required `createApp` argument with no default: `main.ts` and the tests pass the rule explicitly, and an app without one doesn't typecheck and throws at start-up. The app hands the same rule to the `/api` middleware and the MCP endpoint; M8.5 (Members sign in) swaps it for membership lookups.

## What it doesn't cover yet

- **Cross-project routes and tools** (lists, dashboard, inbox, question answers, config changes by id, owner settings): allowed by the lists above, each with how M8.7 (Cross-project lists per member) filters it.
- **Writes:** roles decide them in the permission function (M8.4, M8.6), not here.

**Create a project (AI-297):** `POST /api/projects` and MCP `create_project` both call `ProjectService.register`, which requires the owner action `register_project`; it validates the key and repos and stores the project, starting nothing.

**Milestones (AI-304, ADR-0131):** `…/milestones` routes and MCP `list_milestones`, `set_milestone_status`, `set_epic_milestone` name their project, so this check covers them. Reads are open to project readers; writes need the owner action `change_milestones`, and attaching refuses another project's milestone. Ticket edits (PATCH, `edit_ticket`) can't set a milestone. Agent tasks have no MCP tools.
