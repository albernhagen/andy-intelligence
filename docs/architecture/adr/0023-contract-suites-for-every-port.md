---
status: accepted
date: 2026-10-22
supersedes: 0012
---

# 0023 — Every port gets a fake and a contract suite

## Context and Problem Statement

ADR-0012 proposed contract suites only for WorkTracker, Executor and QuotaSource, leaving single-adapter ports (ModelGateway, Notifier, Deployer, Evaluator, Telemetry, CodeHost) as bare interfaces. Andy rejected it.

## Decision Outcome

ARCHITECTURE §6 stands as originally written: every port has an in-memory fake and a shared contract test suite that every adapter, including the fake, must pass.

To keep this from becoming up-front scaffolding, a port's fake and suite are written **in the slice that first uses or adapts that port**, before its first real adapter: CodeHost in M1.5; ModelGateway in M3; Deployer in M5; Notifier, Evaluator and Telemetry when their first slice is planned.

### Consequences

- Good: the swap-a-vendor promise is tested from the first adapter; fakes are trustworthy in domain tests.
- Bad: more test code for ports that may never get a second adapter.
