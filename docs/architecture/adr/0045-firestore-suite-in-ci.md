---
status: accepted
date: 2026-11-04
amends: 0034
---

# 0045 — Firestore contract suites run in CI when the adapters change

Decided by Andy, 2026-11-04, after M1.5: GitHub App + project registration and M1.19: GitHub App setup from the UI each added Firestore adapters whose emulator suite nobody ran until verification.

## Context and Problem Statement

ADR-0034 kept the emulator-backed suites out of CI to save 1–2 minutes per run. In practice the local run is easy to forget (it needs Java on `PATH`), so a broken Firestore adapter could merge.

## Decision Outcome

- New workflow `firestore-suite.yml`, job `firestore-suite`, on every PR and push to `main`. It always runs, so its check always reports.
- It starts the emulator (Temurin 21, emulator jar cached) and runs `pnpm test:firestore` only when the diff touches `packages/store`, `packages/contracts/src`, `firebase.json`, `package.json`, `pnpm-lock.yaml` or the workflow itself. Otherwise it passes in seconds with a "skipped" notice.
- Not a required check yet. Andy can add `firestore-suite` to the `main` ruleset (`platform/baseline/github/ruleset-main.json`) after it has run green a few times.
- `pnpm test:firestore` stays available locally.

### Consequences

- Good: adapter regressions are caught on the PR; most PRs pay nothing.
- Bad: about 1–2 minutes on PRs that touch the adapters or dependencies (Dependabot lockfile PRs included). Not carried to managed projects: none has Firestore adapters (§8.1).
