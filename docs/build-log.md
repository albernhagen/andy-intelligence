# Build log — status

Current state only: slices, what's next, decisions pending, blockers. Keep it under one page (context budget, ADR-0046). What happened and why goes in the history: [`docs/build-log/`](build-log/), one new file per entry (`YYYY-MM-DD-<slug>.md`), so parallel PRs never edit the same file.

Temporary until andy-intelligence tracks its own work (then migrated to tickets).

## Slices: M1: First end-to-end flow: ticket → PR with Claude

Status: todo / in progress / PR open. Definitions: ARCHITECTURE §12.

**Merged:** M1.0: Docs sync (PR #1); M1.1: MCP OAuth spike (PR #29); M1.2: Ticket core (PR #17); M1.3: UI: tickets + inbox (PR #28); M1.4: MCP core tools (PR #31); M1.5: GitHub App + project registration (PR #32); M1.10: Security review automation (PR #10); M1.11: Adversarial PR review (PR #21); M1.12: Local quality gates (PR #9); M1.13: GCP cost guardrails (PR #7); M1.14: Cost kill switch (PR #18); M1.15: Usage alerts (PR #8); M1.16: Project baseline v1 (PR #23); M1.19: GitHub App setup from the UI (PR #36); M1.20: Custom domain (PR #38).

| Slice                                 | Size | Depends on                                                                   | Status |
| ------------------------------------- | ---- | ---------------------------------------------------------------------------- | ------ |
| M1.6a: dispatch + callback            | M    | M1.5: GitHub App + project registration, M1.19: GitHub App setup from the UI | todo   |
| M1.7: Refinement                      | M    | M1.3: UI: tickets + inbox, M1.4: MCP core tools, M1.6a                       | todo   |
| M1.8: Build + gate (plan, auto-merge) | M    | M1.7: Refinement, M1.16: Project baseline v1                                 | todo   |
| M1.6b: watchdog + retry               | S    | M1.6a                                                                        | todo   |
| M1.17: Agent evals v1                 | M    | M1.8: Build + gate                                                           | todo   |
| M1.9: Quota capture                   | S    | M1.8: Build + gate                                                           | todo   |

**Waves (Andy, 2026-11-04, ADR-0050):** 1. M1.6a → 2. M1.7: Refinement → 3. M1.8: Build + gate → 4. M1.6b ‖ M1.17: Agent evals v1 ‖ M1.9: Quota capture. M1.18: Plan step is folded into M1.8.

**Pending decisions (Andy):**

- Email notifications for Needs-you (a `Notifier` adapter, S): move up from Later so the loop doesn't wait for an open tab?
- Safe deploy path for the control plane (tagged no-traffic Cloud Run revision per PR + rollback runbook) before agents merge here (ADR-0047 phase 2).
- Retire this file into tickets in project `AI` (ADR-0047 phase 1): now?
- Contract suites for ports with one adapter (`OAuthGrantStore`, `CodeHostConnectionStore`): keep the fakes, drop the shared suite?
- Local mode design (open question 11); due after M1: First end-to-end flow.
- Context sources design (open question 12); due after M1: First end-to-end flow.

**Blocked on Andy:** nothing.
