# 2026-11-12 — AI-83: M5.1: Managed-repo runs: design (ADR-0096)

- ADR-0096: Managed repos call one executor. A registered project's repo gets a thin caller, `agent-run.yml`, that calls this repo's `claude-executor.yml@main`. No product code changed.
- Accepted only from a registered repo: dispatch goes to an enabled project's `repos[0]` with the App installed and default branch `main`; callbacks already match the task's recorded repo, executor ref and workflow run; the push grant replaces its one static `TOKEN_POLICY` entry with a rule (registered repo, its `agent-run.yml` on `main`, our executor, then `claimPushGrant`). Everything else is refused, as today.
- Each managed repo holds its own Claude token; the control plane never relays it.
- Planned rows: entry point in `docs/security/agents-and-executors.md`, risk R-AI-83 in the threat model. To fit the word budgets, closed rows R25 and R26 and a few others were shortened (no meaning changed).
- Andy's steps per new repo (App install, Actions settings, register, caller, secret, first refine) are in the ADR for AI-111: M5.4: First managed project live.
- Open questions for Andy (in the ADR, each with a recommendation): where the Claude token lives (recommended: an environment limited to `main`); `@main` or a SHA pin (recommended: `@main`); one repo per project (recommended: yes for M5). AI-105 and AI-106 build against the recommendations.
