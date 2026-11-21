# 2026-11-21 — AI-283: Flaky Firestore test: RoutingConfigStore "two editors, same stamp"

`GivenTwoEditorsWithTheSameStamp_WhenBothPut_ThenExactlyOneWins` timed out once at 5 s on `main` (109fd2b) and passed on re-run.

- **Cause: emulator timing, not the store.** Two puts with the same stamp are two transactions on one document. The emulator holds the conflicting commit about 2 s and then aborts it; `@google-cloud/firestore` retries after about 1 s (±50% jitter), and the loser then reads the new stamp and throws `conflict` (not retried). One collision settles in about 3 s; a second one passes 5 s. Same measurement as AI-138 (`notify-ledger.firestore.test.ts`). Production Firestore aborts a contended commit in milliseconds, so a two-editor put settles after one retry: no store change.
- **Fix:** the routing contract suite takes `raceTimeoutMs`, like the other suites with racing cases (AI-138), and the Firestore run gives that one case 30 s, with the reason beside the constant. The in-memory fake keeps 5 s.
- **Other "exactly one wins" suites checked:** every racing case against a transaction already has a race or slow timeout (`itRaces` or membership's `itSlow`); project versions (blind increment) and the code event log (`create()`, no transaction) don't contend, so they need none.
- **50 runs in a row** of the routing store suite against the emulator (local, one emulator): 50 passed. The racing case took 2.6–3.5 s (median 3.2 s), the one-collision time above, so 5 s left under 2 s of margin for a second collision.
