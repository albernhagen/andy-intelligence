---
title: "Pre-push runs only affected tests; CI keeps the full suite"
status: accepted (Andy, 2026-11-25)
date: 2026-11-20
amends: 0027
---

# 0113 — Pre-push runs only the tests a push can affect; CI keeps the full suite

## Context and Problem Statement

ADR-0027 put `pnpm typecheck` and `pnpm test` (the whole suite, 2,624 tests) in the lefthook `pre-push` hook. With a coordinator running up to fifteen worker sessions on one 14-core Mac (ADR-0047), several workers push at once and each hook runs the full suite. On 2026-11-12 to 11-20 that starved the machine: timing-sensitive tests timed out, pushes failed, and workers retried, adding more load.

## Considered Options

1. **Affected tests only:** `vitest run --changed origin/main` (tests whose imports reach a file that differs from `origin/main`; a changed `package.json` or vitest config reruns everything), plus the full typecheck.
2. **A machine-wide lock:** one worktree runs the full suite at a time. Keeps local coverage but serialises: the tenth push waits about ten suite runs, past an agent's command timeout.
3. **Keep the full suite and stagger pushes by hand.** Depends on every session remembering.

## Decision Outcome

Option 1. Same gate in CI: `platform/actions/ci-check` still runs `pnpm test` (the full suite) on every PR, and the ruleset requires it to merge. Without an `origin/main` ref (a fresh clone of a managed repo before its first fetch) the hook runs the full suite.

Measured on the 14-core Mac (AI-149 PR): one push went from about 180 CPU-seconds to about 41; typecheck (about 30 CPU-seconds) is now most of it.

## Consequences

- Good: parallel pushes no longer run the whole suite each; managed projects get the same hook (`lefthook.yml` is a managed baseline file, ARCHITECTURE §8.1).
- Bad: a test that breaks through a path vitest cannot see (a file read at runtime, not imported) is caught in CI, not before the push. A stale `origin/main` only widens the set of tests run.
