---
status: proposed
date: 2026-11-12
amends: 0079 (dispatch caps), 0083 (sync runs)
---

# 0100 — At quota warn, one agent task in flight across all projects

AI-92: M5.8: Quota-aware dispatch. ARCHITECTURE §5 keeps subscription reserves; §12 M5 asks for "quota-aware dispatch so parallel runs keep the subscription reserves".

## Context and Problem Statement

ADR-0079 stops dispatch only at `pause` (80%). With several projects running, the global cap lets four agent tasks start at 79% and overshoot the reserve before any of them reports.

## Decision Outcome

- While the worst fresh quota reading is at `warn` (70%), the cap on agent tasks in flight across all projects is **1** (`MAX_ACTIVE_RUNS_AT_WARN`). The number is an assumption Andy may change at review.
- `mayDispatch` checks it last, after `quota_reserve`, and returns the new idle reason `quota_warn`. `maySync` (ADR-0083) checks it after `quota_reserve` too: a sync task is an agent task.
- A project idle on `quota_warn` waits for a slot like one on `global_cap`: a task's end wakes it first, longest wait first (`waitsForSlot`, AI-91's `dispatchOrder`).
- Unchanged: `ok` and `unknown` don't limit dispatch; readings older than 6 hours don't count (ADR-0079); refine tasks aren't gated by quota at either level; **Clear quota idle** (ADR-0085) acts on `pause` only.

### Consequences

- Good: near the reserve, at most one task spends quota before the next report, so parallel projects can't jump from warn past pause unseen.
- Bad: from 70% to 80%, throughput drops to one task across all projects. A false warn reading slows dispatch for up to 6 hours and can't be cleared by hand.
