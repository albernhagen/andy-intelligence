import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "local-runner",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Each test drives real git worktrees and child processes (on macOS, the real sandbox-exec);
    // a busy machine stretches them far past vitest's 5 s default. Same budget as the Firestore
    // race tests.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
