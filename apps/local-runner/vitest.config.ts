import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "local-runner",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Real git, worktrees and child processes per test: slow on a loaded machine.
    testTimeout: 20_000,
  },
});
