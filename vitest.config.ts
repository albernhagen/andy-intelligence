import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./vitest.temp-dir.ts"],
    projects: [
      "packages/*",
      "apps/api",
      "apps/web",
      "apps/local-runner",
      { test: { name: "scripts", include: ["scripts/**/*.test.mjs", "platform/**/*.test.mjs"] } },
    ],
  },
});
