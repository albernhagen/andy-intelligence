import { defineConfig } from "@playwright/test";

const PORT = 4174;
const CI = !!process.env.CI;

/**
 * Screenshot checks (ADR-0059: Visual checks): the shell, board and ticket page against the
 * real API over seeded fakes. Stored images are Linux renders; update them with
 * `pnpm --filter @andy/web screenshots:update` (runs in the Playwright Docker image).
 */
export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  outputDir: "test-results",
  workers: 1,
  retries: 0,
  forbidOnly: CI,
  timeout: 30_000,
  // Cap the whole run (ADR-0028): a hung browser can't hold a CI runner.
  globalTimeout: 5 * 60_000,
  reporter: CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  expect: { toHaveScreenshot: { animations: "disabled", caret: "hide" } },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
  },
  webServer: {
    command: `vite --config e2e/vite.config.ts --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
