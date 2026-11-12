# 2026-11-11 — AI-78: Flaky sync publish test

- **Symptom:** `scripts/executor-publish-sync.test.mjs`, "GivenAResolutionThatTouchesADependencyFile…", failed once in a pre-push hook with `a.txt: conflict markers left`; reruns passed.
- **Cause (reproduced):** shared state between test runs, not a bug in `publishSync`.
  - `publishSync` checks the agent's patch in a scratch git index at `$RUNNER_TEMP/sync-check-<RUN_ID>.index`, falling back to the OS temp dir when `RUNNER_TEMP` is unset.
  - The test harness left `RUNNER_TEMP` unset and always used `RUN_ID: sync1`, so every run on the machine used one file: `$TMPDIR/sync-check-sync1.index`.
  - Two runs at once (parallel sessions' pre-push hooks, each in its own worktree) share that file. One run's `read-tree` of the conflicted merge lands between the other's `apply --cached` and its marker check, which then reads the markers back. The repos' blobs are identical, so nothing else fails. Sometimes the clash shows instead as `index.lock: File exists`.
  - On a runner, `RUNNER_TEMP` is a fresh directory per job and `RUN_ID` is unique, so production never shares the file.
- **Fix (test only):** the harness gives each publish its own `RUNNER_TEMP` (as a runner does), and each patch is written to its own temp directory instead of `$TMPDIR/<milliseconds>-change.patch`. A new test plays the other run's `read-tree` at exactly that moment and checks that it ran and that this publish's index sat in its own `RUNNER_TEMP`; it fails on the old harness with the same error and passes now. No change to `scripts/executor-publish.mjs`.
- **Proof (PR #153: AI-78), rounds of 4 concurrent runs of the file:**
  - Locally, before (the `main` test file): 43 of 60 runs failed, 17 with `conflict markers left`, the rest on `index.lock`. After: 0 of 240.
  - Locally, 30 full `pnpm test` runs in a row after the fix: 30 passed.
  - A plain CI matrix can't show this: each job runs the file once, alone. A temporary 20-job matrix (Linux, run 43089999205 at d935e9b) ran 5 rounds of 4 concurrent copies per job, before and after; removed before review. Before: 154 of 400 runs failed (4 to 11 per job). After: 0 of 400.
- **Also (AI-71 follow-up):** the OAuthGrantStore race case, "GivenConcurrentTakes_WhenRacing_ThenExactlyOneWins", races three Firestore transactions on vitest's 5 s default, the AI-71 weakness. `oauthGrantStoreContract` now takes `raceTimeoutMs` like the other contracts, and the Firestore test passes 30 s.
