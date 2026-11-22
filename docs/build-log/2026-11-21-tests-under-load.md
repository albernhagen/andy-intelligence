# 2026-11-21 — Tests under load, second pass (AI-219: Web tests time out when several sessions push at once)

PR #246 lengthened one wait in three web files. Pushes still failed on other tests at a 1-minute load of 50 to 100 (14-core Mac): `apps/web/src/night.test.tsx` and others, all passing alone; CI's Firestore suite once timed out a work-tracker test at 5 s.

- **Common cause:** CPU contention. Each pre-push run started one Vitest worker per core, so a few sessions pushing at once ran 40+ workers on 14 cores; cold page renders (0.1 to 0.5 s alone) and git or emulator round trips then passed 1 s and 5 s defaults. Separately, the pre-push tests could start on package barrels a merge left stale, because only `typecheck` (in parallel) regenerated them.
- **Root fixes (pre-push hook, `lefthook.yml`):** the test command regenerates the barrels first and runs Vitest with `--maxWorkers=25%`.
- **Timeouts, each CPU-bound and named:** web `findBy*`/`waitFor` default 4 s (`apps/web/src/test/timeouts.ts`, set in `setup.ts`) and a 15 s web test timeout; 30 s for the `store` (emulator) and `scripts` (git subprocess) projects, as local-runner has had since AI-138. No assertion changed; nothing skipped.
- **Proof:** the affected files passed 20 runs in a row under 28 CPU burners (see the PR).
