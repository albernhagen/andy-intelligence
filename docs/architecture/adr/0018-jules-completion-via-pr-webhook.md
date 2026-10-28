---
status: accepted
date: 2026-10-22
---

# 0018 — Jules run completion via the PR webhook, with a deadline watchdog

## Context and Problem Statement

ARCHITECTURE revision 2026-10-21a said to "poll Jules activities incrementally", which contradicts the event-driven, no-polling rule (ADR-0017). Jules runs in Google's infrastructure and cannot call our API back.

## Considered Options

1. Poll the Jules `activities` endpoint on a schedule.
2. **Configure Jules to open a PR on completion; treat the GitHub `pull_request` opened webhook as the completion signal; the per-run watchdog reads `activities` once at the deadline.**

## Decision Outcome

Option 2. The Run is correlated to the PR by branch name or a run marker in the PR body. `activities` are read on demand only (watchdog, run detail view).

### Consequences

- Good: no polling; reuses the GitHub App webhook receiver that Claude Code runs already need.
- Bad: depends on Jules's auto-PR behavior via the REST API — **unverified**; must be checked against current Jules docs before the M2 Jules slice (open question 10). A run that ends without a PR is detected only at its deadline.
