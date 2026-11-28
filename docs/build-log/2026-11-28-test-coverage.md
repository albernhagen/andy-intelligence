# 2026-11-28: Test coverage in CI (AI-407)

**Decision (Andy):** test coverage is part of the build pipeline for this repo and every managed project. Of three options (report only; a floor per package; a fixed 80% gate plus 80% on changed lines), Andy chose the floor.

**What that means:**

- Floors are each package's coverage on 2026-11-28 minus about 2 points, rounded down, in `vitest.config.ts`. A drop below one fails `check`.
- Changed-line coverage is reported in the job summary and warns under 80%. It never fails a PR.
- New managed projects start at 80% lines, statements and functions, and 70% branches (`template/starter/vitest.config.ts`). A brand-new project is near 100%, so measured-minus-2 would be too tight there.

**Measured (lines / branches):** api 95 / 82, local-runner 78 / 68, web 92 / 85, contracts 100 / 96, domain 96 / 90, github 95 / 72, store 11 / 7 (its tests run on the Firestore emulator, outside `check`), platform 66 / 71, scripts 79 / 74. Scripts that tests run as child processes don't count toward coverage, which is why `scripts` and `platform` read low.
