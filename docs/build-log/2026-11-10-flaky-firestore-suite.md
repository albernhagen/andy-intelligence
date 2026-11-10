# 2026-11-10 — AI-71: Flaky Firestore suite

- **Symptom:** the `firestore-suite` check timed out a RunStore race case at vitest's 5 s default: on `main` at 8d5e8f6 (run 42753930519) and on PR #125: AI-69: Conflict-aware dispatch (run 42716129108). Reruns passed.
- **Cause (measured):** not the adapter. Its transaction is one read and one write.
  - Two transactions read one run, then both commit. The Firestore emulator holds the conflicting commits ~2 s, then aborts one or both.
  - `@google-cloud/firestore` retries after 1 s, then 1.5 s, 2.25 s, 3.4 s (each ±50% jitter), 5 attempts in all.
  - One collision costs 2.5–3.5 s. If both abort and their retries collide again, it costs up to ~7.8 s. Slow CI runners make a second collision more likely.
- **Fix:** `runStoreContract` takes `raceTimeoutMs` for its three race cases. The Firestore test passes 30 s, with the measured cause in a comment. The worst case over all 5 attempts is ~22 s, so a real hang still fails. No production change.
- **Proof:** see PR #129: AI-71 for the numbers. In brief: a 20-job CI matrix before the fix (all passed, races 2.5–3.5 s) and after it (20/20 green). Locally, 150 ms of transaction latency pushed 4 of 40 races past 5 s (7.0–7.5 s, a third attempt each). The matrix was removed before review.
- **Not done:** the OAuthGrantStore race case, "GivenConcurrentTakes_WhenRacing_ThenExactlyOneWins", has the same cause (3.0–3.5 s in CI). It's left out because the ticket covers RunStore only. Follow-up proposed.
