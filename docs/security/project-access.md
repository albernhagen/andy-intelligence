# Threat model: Project access

One check decides whether a caller may read a project, for API routes and MCP tools alike (AI-252: M8.3: One project-access check for API routes and MCP tools). Risk: [R-AI-252](risks/R-AI-252.md). Code: `apps/api/src/project-access.ts`.

## Where the check runs

| Entry                                               | Project it reads             | Refusal                                                                  |
| --------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `/api/projects/{projectId}[/…]` (every method)      | `projectId`                  | `404 {"error":"project not found"}`, the same body as an unknown project |
| `/api/tickets/{KEY}`                                | The key's prefix, lowercased | `404 {"error":"ticket not found: KEY"}`, as an unknown ticket            |
| MCP tool with a `project` input (required or given) | `project`, lowercased        | Tool error `project KEY not found`; the handler doesn't run              |
| MCP tool with a `ticket` input (required or given)  | The key's prefix, lowercased | Tool error `ticket not found: KEY`; the handler doesn't run              |

- Order on `/api/*`: sign-in and allow-list (401, 403), body cap, then this check. Strangers never reach it, so a refusal can't tell them a project exists.
- Each refusal logs a `WARNING` with the actor (`user:<uid>`) and project id; never the email (ADR-0015).
- Never 403: a project you can't read looks like one that doesn't exist.

## Today

`ALLOW_SIGNED_IN`: every allow-listed caller is the owner and reads every project, so nothing changes. The app passes one `projectAccess` to both the `/api` middleware and the MCP endpoint; M8.5 (Members sign in) sets it to membership lookups.

## What it doesn't cover yet

- **Cross-project routes and tools** (lists, dashboard, inbox, question answers, config changes by id, owner settings): listed in `apps/api/src/registries.test.ts` with how M8.7 (Cross-project lists per member) filters each. A new route or tool that is neither checked nor listed fails that test.
- **Ticket keys in API request bodies** (`blockedBy` and `parentId` on ticket create and edit): not checked here (MCP's are; `registries.test.ts` fails on a tool with an unchecked key field). With one owner this changes nothing; M8.5 must check them, or the domain must refuse keys outside the caller's projects, before a member exists.
- **Fails open:** without a `projectAccess`, both default to `ALLOW_SIGNED_IN`. M8.5 should make it required.
- **Writes:** roles decide them in the permission function (M8.4, M8.6), not here.
