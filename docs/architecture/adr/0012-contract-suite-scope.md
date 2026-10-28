---
status: rejected (superseded by 0023)
date: 2026-10-21
---

# 0012 — Contract suites only for WorkTracker, Executor and QuotaSource

**Deviation from ARCHITECTURE §6 — needs Andy's approval.**

## Context and Problem Statement

§6 requires a contract test suite for every port. Notifier, Deployer, Evaluator, Telemetry and ModelGateway each have one adapter in v1.x; a suite with one implementer and a fake mostly tests the fake.

## Decision Outcome (proposed)

- WorkTracker, Executor, QuotaSource: Zod contracts + in-memory fakes + contract suites (done in M0).
- ModelGateway, Notifier, Deployer, Evaluator, Telemetry: TypeScript interfaces only. Add a fake and suite when a second adapter is planned.

### Consequences

- Good: less test scaffolding for ports that won't swap in v1.x.
- Bad: a later second adapter needs its suite written first.
