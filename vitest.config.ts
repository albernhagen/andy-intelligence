import { defineConfig } from "vitest/config";

// Coverage floors (AI-407): each package's measured coverage (2026-11-28) minus about 2 points,
// rounded down. CI fails a PR that drops a package below its floor. Raise a floor when a package
// rises well above it; lower one only with Andy's agreement. `store` is low because its tests run
// against the Firestore emulator in their own workflow (firestore-suite), not in `check`.
const floors = {
  "apps/api/src/**": { lines: 93, statements: 90, functions: 91, branches: 80 },
  "apps/local-runner/src/**": { lines: 76, statements: 74, functions: 74, branches: 66 },
  "apps/web/src/**": { lines: 90, statements: 89, functions: 88, branches: 82 },
  "packages/contracts/src/**": { lines: 97, statements: 97, functions: 96, branches: 93 },
  "packages/domain/src/**": { lines: 94, statements: 92, functions: 94, branches: 88 },
  "packages/github/src/**": { lines: 93, statements: 85, functions: 92, branches: 70 },
  "packages/store/src/**": { lines: 9, statements: 8, functions: 5, branches: 5 },
  "platform/**": { lines: 63, statements: 63, functions: 74, branches: 68 },
  "scripts/**": { lines: 76, statements: 76, functions: 81, branches: 72 },
};

export default defineConfig({
  test: {
    globalSetup: ["./vitest.temp-dir.ts"],
    // Test coverage (AI-407): off for a plain `pnpm test` (`pnpm test --coverage` turns it on); the
    // `ci-check` action turns it on. Feature doc: docs/features/test-coverage.md.
    coverage: {
      provider: "v8",
      include: [
        "packages/*/src/**/*.{ts,tsx}",
        "apps/*/src/**/*.{ts,tsx}",
        "scripts/**/*.mjs",
        "platform/**/*.mjs",
      ],
      exclude: ["**/*.test.*", "**/*testlib*", "**/src/test/**", "**/*.gen.ts", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "json"],
      // A test shard sees only part of the suite, so the `ci-check` action sets COVERAGE_FLOORS=off
      // there and checks the floors once, on the merged shards.
      thresholds: process.env.COVERAGE_FLOORS === "off" ? {} : floors,
    },
    projects: [
      "packages/*",
      "apps/api",
      "apps/web",
      "apps/local-runner",
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.mjs", "platform/**/*.test.mjs"],
          // AI-219: the executor tests build git repos and run git subprocesses per test, which
          // passed the 5 s default under load. Same as local-runner (AI-138).
          testTimeout: 30_000,
        },
      },
    ],
  },
});
