---
status: accepted, amended by 0048
date: 2026-11-01
amends: 0023
---

# 0034 — Contract suites that need an emulator run locally, not in CI

Decided by Andy, 2026-11-01 (M1.2: Ticket core).

## Context and Problem Statement

ADR-0023 says every adapter passes its port's contract suite. The Firestore `WorkTracker` adapter can only run its suite against the Firestore emulator, which needs Java and `firebase-tools`. Running it in CI adds 1–2 minutes per run, which Andy rejected.

## Decision Outcome

- CI runs every contract suite against the in-memory fakes only.
- Adapters whose suite needs an emulator or sandbox run it **on demand locally**: `pnpm test:firestore` starts the Firestore emulator (`firebase-tools`, pinned) and runs the same suite on the real adapter. Without the emulator the test is skipped, not failed.
- Run it when the adapter or the suite changes, and say so in the PR's "How verified".
- ADR-0023 otherwise stands: every port still gets a fake and a contract suite.

### Consequences

- Good: CI stays fast; the real adapter is still testable with the same suite.
- Bad: a regression in the Firestore adapter can merge if the local run is skipped. Mitigated by the PR checklist line and by the domain and API tests, which use the fake that passes the same suite.
