# 2026-11-12 — AI-97: M5.19: Agent read access: design (ADR-0099)

- ADR-0099: Agents get a read-only run token. Each agent task gets an opaque token, minted with its context (Actions) or claim (local), stored as a hash on the run, cleared when the run settles, never valid past the run's deadline (≤ 90 minutes).
- It works only on a new endpoint, `/mcp/agent`, which registers three read tools (`status` for one key, `list_in_flight`, `list_ready`), each limited to the run's project. No write tool exists there and no REST route takes the token.
- Claude Code holds it as an MCP server header from a config outside the checkout; the agent never reads it. The profile allows exactly that one MCP server.
- Caps: 50 calls a run, 10 a minute, 32 KB a result.
- Planned rows: entry point and credential in `docs/security/ui-and-mcp.md`, risk R-AI-97 in the threat model. To fit the budgets: R11's fetch limits now point to ADR-0039, which lists them; the SPA rendering detail moved to `ui-and-mcp.md`; a few ADR index and risk lines were shortened (meaning unchanged).
- Open questions for Andy, each with a recommendation: which steps (recommended: refine, plan, build), which tools (recommended: the three), live tools or a bigger dispatch snapshot (recommended: live tools).
- Stacked on PR #167 (AI-83) for the shared docs; its PR opens after #167 merges.
