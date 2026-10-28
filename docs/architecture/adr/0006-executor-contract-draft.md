---
status: accepted
date: 2026-10-21
---

# 0006 — Executor contract stays draft until two real adapters pass

## Decision Outcome

`Executor` (`start` / `status` / `cancel`, idempotent by `runId`) is marked DRAFT in `packages/contracts`. It may change freely until the Claude Code (Actions) and Jules (REST) adapters both pass the executor contract suite (M2). Then it is frozen and further changes need a new ADR.

### Consequences

- Good: avoids freezing an abstraction shaped by one vendor.
- Bad: M1 code against the Executor may need refactoring in M2.
