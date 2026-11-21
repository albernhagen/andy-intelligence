---
title: API and MCP reference printed from the code
status: proposed (AI-146; Andy decides at review)
date: 2026-11-21
---

# 0125 — API and MCP reference printed from the code, not committed

AI-146: API, MCP and README reference tables generated from the code (epic AI-140: Parallel development without merge conflicts). Builds on ADR-0110 (code registries) and follows ADR-0103 and ADR-0104.

## Context and Problem Statement

`docs/architecture/api-and-mcp.md`, `docs/security/ui-and-mcp.md`, `README.md` and `docs/features/claude-connector-mcp.md` listed MCP tools and routes by hand, so every PR adding one edited them and they conflicted on nearly every re-sync. The ticket asked for a generated reference file with a CI check, and for two PRs that each add a tool or route to merge without a conflict in these docs.

## Considered Options

1. A committed, generated reference file that CI compares with the code. Two PRs adding neighbouring tools still conflict on it.
2. No committed reference: `pnpm reference` prints it from the app as built; tests keep the docs honest.

## Decision Outcome

Option 2.

- `pnpm reference` (`apps/api/src/reference.ts`) prints every MCP tool with the first sentence of its description, the owner-only actions (`OWNER_ACTIONS`, AI-19) and every route with whether it sits behind the `/api` sign-in (from registration order).
- `apps/api/src/reference.test.ts` (in `pnpm test`, so the `check` job) fails, naming `pnpm reference`, when a route outside the sign-in isn't named in `docs/security/`, so every entry point still says who can reach it and how. It found `GET /openapi.json` undocumented; it is now listed as public.
- The design docs, the security area file, the README and the feature file keep their rules and point at `pnpm reference` in place of tool and route lists.

### Consequences

- Good: adding a tool or route touches no doc list; nothing generated is committed, so nothing conflicts.
- Bad: no per-tool owner-only flag. Tools don't declare which `OWNER_ACTIONS` they use (descriptions say "Andy only" inconsistently), so the reference lists the actions, not a column per tool. A per-tool flag needs each tool to declare its action: a follow-up.
