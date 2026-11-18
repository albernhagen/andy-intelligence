import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "local-runner",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Each test drives real git worktrees and child processes (on macOS, the real sandbox-exec);
    // a busy machine stretches them far past vitest's 5 s default. Same budget as the Firestore
    // race tests.
    testTimeout: 30_000,
    // Its two files spawn git, node and (on macOS) sandbox-exec processes: running them side by
    // side doubled their wall time and starved the other projects' workers.
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
