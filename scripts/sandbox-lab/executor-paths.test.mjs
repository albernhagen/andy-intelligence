import { describe, expect, it } from "vitest";
import { touchesExecutor } from "./executor-paths.mjs";

describe("touchesExecutor", () => {
  it.each([
    "platform/executor/profile.json",
    "platform/actions/sandbox-self-test/action.yml",
    "scripts/executor-sandbox.mjs",
    "scripts/sandbox-lab/lab.sh",
    ".github/workflows/claude-executor.yml",
    ".github/workflows/agent-run.yml",
    ".github/workflows/sandbox-self-test.yml",
  ])("GivenExecutorPath_WhenChecked_ThenRuns: %s", (path) => {
    expect(touchesExecutor(["README.md", path])).toBe(true);
  });

  it.each([
    "docs/runbooks/agent-runs.md",
    "scripts/executor-sandbox.md",
    "scripts/nested/executor-sandbox.mjs",
    ".github/workflows/ci.yml",
    "xplatform/executor/profile.json",
  ])("GivenOtherPath_WhenChecked_ThenSkips: %s", (path) => {
    expect(touchesExecutor([path])).toBe(false);
  });

  it("GivenNoPaths_WhenChecked_ThenSkips", () => {
    expect(touchesExecutor([])).toBe(false);
  });
});
