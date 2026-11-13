import { defineProject } from "vitest/config";

// The loop tests run real git, node children and (on macOS) sandbox-exec: allow for a busy machine.
export default defineProject({
  test: {
    name: "local-runner",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
