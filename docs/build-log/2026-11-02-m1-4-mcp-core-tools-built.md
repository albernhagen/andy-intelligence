# 2026-11-02 — M1.4: MCP core tools built

- **Decided (Andy):** remove the throwaway `ping` (`status` with no ticket is the connection check); find tickets by key with a domain helper (project id = lowercased key prefix, then match), no port change; `status` = one ticket by key, or an overview when no key is given.
- PR #31: MCP core tools (branch `m1.4/mcp-core-tools`): `apps/api/src/mcp/tools.ts` with `create_ticket`, `list_needs_me`, `answer_question`, `status`, all through the REST API's `TicketService`; `TicketService.findByKey/status/overview` in `packages/domain`. Threat model: `/mcp` row, R12 reassessed, R15 (agent-written question text reaching Claude desktop).
- Follow-up (adversarial review on PR #31): `status` reads whole projects. Add `getTicketByKey` + per-stage counts to the `WorkTracker` port before ~1,000 tickets in a project or M2: Multi-project in parallel (ARCHITECTURE §7.1).
- Verified locally: lint, typecheck, tests (MCP SDK client in-process: each tool, tool errors, the create → question → answer → Ready flow), build. Not run here: the Claude desktop check (Andy, runbook `mcp-connector.md` §4b, after deploy). No Terraform or Firestore adapter change.
