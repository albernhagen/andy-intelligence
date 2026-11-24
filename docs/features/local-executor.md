# Local executor

Executor (Actions or local) per project and ticket: ticket panel, settings, MCP. Runners claim `local` tickets; lost lease: Needs you; no runner: `local` defaults go to Actions, overrides wait. `apps/local-runner`: refine, plan, build (ADR-0122)

**How to use:** Settings → Local runners: mint, presence, revoke; MCP `list_runners` lists them (AI-294) and `revoke_runner` revokes one, owner only (AI-351)
