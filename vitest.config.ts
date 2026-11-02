import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/api",
      "apps/web",
      { test: { name: "scripts", include: ["scripts/**/*.test.mjs", "platform/**/*.test.mjs"] } },
    ],
  },
});
