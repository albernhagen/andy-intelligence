import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "store",
    // AI-219: emulator-backed suites make dozens of round trips per test (transactions, retries);
    // CI's emulator once took past the 5 s default on a work-tracker count test. Same as
    // local-runner (AI-138).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
