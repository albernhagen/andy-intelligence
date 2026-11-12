---
status: proposed (design; build sliced after Andy merges; Andy decides at review)
date: 2026-11-12
amends: 0051 (the agent may hold one read-only credential), 0040 (the executor profile allows one MCP server), 0089 (the claim also returns the read token)
---

# 0099 — Agent read access: a run-scoped, read-only MCP token for one project

AI-97: M5.19: Agent read access to the API and MCP, scoped per project: design. ARCHITECTURE §7.2 ("Ticket context for agents") says that until M5: Multi-project in parallel the dispatch snapshot is all an agent gets, and then it may call the API or MCP read-only, scoped to its project. This ADR says how.

## Context and Problem Statement

An agent task (refine, plan, build) sees only its own ticket's snapshot. It can't see a sibling ticket it depends on, what else is being built (overlap, ADR-0080), or Ready tickets that duplicate it. Andy's MCP connector can, but its token acts as Andy on every tool, including writes.

The read access must:

- be **read-only** and limited to the **run's project**;
- be **short-lived** and die when the run settles;
- be **capped** per run (ADR-0028);
- keep ADR-0051's rule that the agent process holds no credential it can use itself: the agent calls tools; it never reads the token.

Terms. **Read token**: the new credential. **Agent MCP endpoint**: a new route, `/mcp/agent`, serving only read tools. **Settles**: the run reaches a final status (`succeeded`, `failed`, `cancelled`) or its deadline.

## Considered Options

| Option                                                                                                      | Consequences                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. A read token per run for a separate agent MCP endpoint; Claude Code holds it as an MCP server header** | The agent asks for what it needs, when it needs it. Claude Code sends the header; the agent has no tool that reads it. Writes are impossible: the endpoint registers no write tool.              |
| B. Reuse `/mcp` with a read-only scope on the token                                                         | One endpoint, but every write tool is registered on it and only a scope check stands between a run and Andy's writes. One missed check is a write as Andy.                                       |
| C. No live calls: dispatch adds a bundle (parent, children, blockers, in-flight list) to the snapshot       | No new credential or endpoint. The bundle is chosen up front, so it is bigger than needed or misses the ticket the agent wanted; it is stale by the time a long build reads it. Open question 3. |
| D. The agent calls the REST API with Bash or WebFetch                                                       | Refine and plan have no Bash or web tools; build's sandbox allows the package registry only. Opening either is a larger change than one MCP server.                                              |

## Decision Outcome

Option A (open question 3 asks whether C is enough for now).

### The credential

| Topic        | Decision                                                                                                                                                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape        | Opaque random token, `airr_` + 43 URL-safe characters, distinct from the local runner's per-run token (`airt_`), so a leaked read token can't report, ask questions or claim a push grant.                                                                                                                                                                             |
| Minted       | Once per run, in the `GET /runs/{id}/context` response for Actions runs (OIDC-checked, ADR-0019) and in the `POST /runner/claim` response for local runs (ADR-0089). A second context call gets no new token.                                                                                                                                                          |
| Stored       | SHA-256 hash on the run (`Run.readTokenHash`), never the token.                                                                                                                                                                                                                                                                                                        |
| Bound to     | One run, so one project and one step. The project comes from the run on every call, never from the request.                                                                                                                                                                                                                                                            |
| Valid while  | The run is not settled and before its deadline (at most 90 minutes for a build, 45 for refine and plan: `STEP_LIMITS`). Checked on every call against the run.                                                                                                                                                                                                         |
| Revoked      | When the run settles, the hash is cleared in the same write as the final status. A cancel or watchdog fail revokes it the same way. Nothing to clean up later.                                                                                                                                                                                                         |
| Who holds it | Claude Code's MCP client: the executor writes an MCP config file outside the checkout (`$RUNNER_TEMP`, or the runner user's temp dir) with the token as an `Authorization` header and passes it with `--mcp-config` and `--strict-mcp-config`. The agent's Read is denied outside the checkout; build's sandboxed Bash can't read the file or the Claude Code process. |
| Handoff      | Actions: the `context` job passes it to the `agent` job as a job output (like the prompt) and the agent job masks it first. Slice 2 must show the output reaches no log and no API a repo reader can call; if not, the build stops and this ADR is amended. Local: the runner holds it in memory.                                                                      |

### What it may call

The agent MCP endpoint `/mcp/agent` is a separate MCP server built per request with only these tools, each limited to the run's project:

| Tool             | Returns                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `status` (a key) | One ticket in the run's project: stage, fields, questions and recent history, as for Andy. Another project's key: not found. No overview. |
| `list_in_flight` | The run's project's agent tasks in flight: ticket, branch, PR, `touches`, reserved ADR number (ADR-0080).                                 |
| `list_ready`     | The run's project's Ready and Up next tickets, titles and keys.                                                                           |

Not on it (open question 2): every write tool, `list_needs_me`, `digest`, `get_project_settings`, quota, cost and dispatch tools, and anything about other projects. No REST route accepts the read token. A ticket's text in a result is untrusted, as in the snapshot: the procedures say so, and results are capped.

Which steps get it (open question 1): refine, plan and build; not sync. The executor profile (`platform/executor/profile.json`) allows exactly one MCP server, `andy-intelligence-read`, and its tools are added to the step's allowed tools; project MCP servers stay off.

### Caps (ADR-0028)

| Cap                      | Value                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Tool calls per run       | 50 (`AGENT_READ_CALLS_PER_RUN`), counted on the run; the 51st gets an error the agent sees |
| Calls per run per minute | 10                                                                                         |
| Result size              | 32 KB per call, truncated with a note                                                      |
| `list_ready` rows        | 50                                                                                         |
| Unknown-token lookups    | the shared per-instance lookup cap on `/mcp` (R14)                                         |
| Lifetime                 | until the run settles or its deadline (≤ 90 minutes)                                       |

Each call costs one Firestore read of the run, plus the tool's own reads; at 50 calls and the global run cap this stays in the free tier.

### Observability

Every call logs `component: agent-mcp`, run ID, tool, result size and whether a cap refused it; never the token or the result. The run's report shows the call count.

### Security

New entry point `/mcp/agent`; new credential, the read token. Planned rows: entry point and credential in `docs/security/ui-and-mcp.md`, risk `R-AI-97` in the threat model.

| Attacker has                                  | Gains                                                                                              | Bounded by                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A guessed or forged token                     | Nothing: `401`.                                                                                    | 256-bit token, hash lookup, shared lookup cap.                                                                                       |
| A leaked read token (log, compromised runner) | Reads three tools' worth of one project's tickets until the run settles.                           | Read-only endpoint; one project; caps; ≤ 90 minutes; revoked at settle.                                                              |
| An injected ticket in the run's prompt        | Reads other tickets in the same project and puts their text in its output (a PR body, a question). | That text is already Andy's and his agents'; same project only; caps; outputs pass the same report caps, publish checks and reviews. |
| Text planted in another ticket                | It reaches agents that read that ticket: a new path for prompt injection between tickets.          | Results marked as data in the procedures; same rules as ticket text (R22); same project only.                                        |

### Build slices

Sliced into tickets after Andy merges this ADR (out of scope here). Proposed:

| Slice                       | Scope                                                                                                                                         | Size | Depends on                  | Risk | Done when Andy can check in minutes                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Design (this ADR, AI-97) | ADR-0099, planned rows                                                                                                                        | S    | —                           | high | He reads it and answers the open questions.                                                                                                    |
| 2. Token and endpoint       | Mint in context and claim, hash on the run, clear at settle; `/mcp/agent` with the three tools, project bound, caps, logs; threat model built | M    | 1                           | high | A test client with a run's token lists that project's in-flight tasks, gets not found for another project's key, and `401` after the run ends. |
| 3. Executor wiring          | Profile entry; MCP config outside the checkout; job-output handoff and its log check; runner support; procedures say results are data         | M    | 2, AI-105: M5.2 (`runs.ts`) | high | A refine on a test ticket shows a `status` call in its report, and its Actions log has no token.                                               |

### Consequences

- Good: agents see siblings, blockers and what is in flight without Andy's token; writes stay impossible by construction.
- Good: the token dies with the run; no rotation, no cleanup.
- Bad: the agent job now holds one credential (read-only), which ADR-0051 kept at none.
- Bad: a new way for one ticket's text to reach another ticket's agent.
- Bad: one more MCP server built and tested alongside `/mcp`.

## Open questions for Andy

1. **Which agent tasks should get read access: refine, plan and build, or only refine and plan?**
   Refine and plan are read-only steps that most need to see siblings and duplicates. A build also benefits (blockers, what's in flight) but runs longest, with Bash.
   - Refine, plan and build: one rule for every step that reads tickets; build's token lives up to 90 minutes.
   - Refine and plan only: the token never sits next to Bash; builds keep using the approved plan, which already saw the context.
   - Recommendation: refine, plan and build. Sync doesn't need it.

2. **Should agents see only tickets and in-flight work, or also Needs-you items, the digest and project settings?**
   The three tools are what an agent needs to avoid duplicates and overlap. The others show quota, cost, Andy's open questions on every ticket and dispatch switches.
   - Three tools (`status`, `list_in_flight`, `list_ready`): smallest surface.
   - Add `list_needs_me` and `digest`: agents could see what Andy is waiting on, but also cost and quota, which they don't need.
   - Recommendation: the three tools; add the key lookup from AI-90: M5.6 when it lands.

3. **Should agents call live read tools, or get a bigger snapshot at dispatch instead, with no new credential?**
   A bundle (parent, children, blockers, in-flight list) needs no token, endpoint or profile change. But it is chosen up front, can't follow a link the agent finds, and goes stale during a long build.
   - Live tools (this ADR): two M slices; one read-only credential per run.
   - Bundle only: one S slice in the dispatch request; nothing new to secure.
   - Recommendation: live tools as designed; if he'd rather not add a credential before M5: Multi-project in parallel ships, the bundle first and live tools later.
