import { defineConfig } from "vitest/config";

// Test coverage (AI-407): CI (the baseline `ci-check` action) runs the tests with `--coverage` and
// fails when coverage drops below these floors. Raise them as the project's coverage grows; a
// floor a little under the measured number catches regressions without blocking every PR.
// `pnpm test --coverage` runs it locally.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // main.ts only starts the server; its pieces are tested in server.test.ts.
      exclude: ["src/**/*.test.ts", "src/main.ts"],
      reporter: ["text-summary", "json-summary", "json"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
