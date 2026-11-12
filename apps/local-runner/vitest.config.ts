import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "local-runner", include: ["src/**/*.test.ts", "test/**/*.test.ts"] },
});
