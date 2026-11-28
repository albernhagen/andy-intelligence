# Test coverage

Every CI run measures test coverage (vitest, `@vitest/coverage-v8`) and fails `check` when a package drops below its floor. The floors live in the repo's `vitest.config.ts` (`coverage.thresholds`): here, each package's coverage on 2026-11-28 minus about 2 points; a new managed project starts at 80% lines, statements and functions and 70% branches. The `check-test` job's summary shows a table per package and, on a PR, how many changed code lines the tests run, with the lines they miss. Under 80% gives a warning, never a failure. Managed projects get it from the baseline `ci-check` action. A repo that already has its own app adds `@vitest/coverage-v8` (same version as vitest) and floors itself. Until it does, CI fails with an error that says so.

**How to use:** Automatic on every PR. Locally: `pnpm test --coverage`. Raise a floor when a package rises well above it; lower one only with Andy's agreement.
