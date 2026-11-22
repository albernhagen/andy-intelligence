import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./vitest.temp-dir.ts"],
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
