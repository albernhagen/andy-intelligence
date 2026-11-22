import { defineProject } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineProject({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "web",
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    // AI-219: a page test does several cold renders and in-process API round trips, each CPU-bound;
    // under a busy machine a few 4 s waits (setup.ts) must fit. Alone the slowest takes ~0.5 s.
    testTimeout: 15_000,
  },
});
