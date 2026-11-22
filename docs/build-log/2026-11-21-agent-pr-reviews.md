# 2026-11-21 — AI-348: agent PRs get a real review

**What happened:** While fixing AI-346, we found that agent PRs (`agent/*`, opened by the control-plane App) had never been reviewed. claude-code-action refuses runs a bot starts, and the check passed as neutral (PR #101). After ADR-0140 they failed closed instead.

**What changed (ADR-0141, proposed):** `agent-review-prepare` gains the `agent-bot` and `agent-branch-prefix` inputs and an `allowed-bots` output. That output is the App's login only when the App started the run on an `agent/*` branch. Both review workflows pass it to the action's `allowed_bots`, and carry-forward is skipped on agent PRs. Tests run the "Decide mode" step as written, and check that each workflow wires only that output. The step runner moved to `scripts/agent-review-testlib.mjs`.
