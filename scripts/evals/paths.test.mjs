import { describe, expect, it } from "vitest";
import { needsEvals } from "./paths.mjs";

describe("needsEvals", () => {
  it.each([
    "platform/procedures/adversarial-review.md",
    "platform/procedures/refine.schema.json",
    "AGENTS.md",
    "CLAUDE.md",
    ".github/AGENTS.md",
    "template/AGENTS.md.template",
    ".claude/settings.json",
    "platform/evals/cases/adversarial-clean-diff.json",
  ])("GivenAgentConfigPath_WhenChecked_ThenRuns: %s", (path) => {
    expect(needsEvals(["README.md", path])).toBe(true);
  });

  it.each([
    "README.md",
    "packages/domain/src/gate.ts",
    "docs/runbooks/agent-evals.md",
    "scripts/evals/run.mjs",
    "xplatform/procedures/build.md",
    "AGENTS.md.bak",
  ])("GivenCodeOnlyPath_WhenChecked_ThenSkips: %s", (path) => {
    expect(needsEvals([path])).toBe(false);
  });

  it.each([
    "scripts/evals/run.mjs",
    "platform/actions/agent-evals/action.yml",
    ".github/workflows/agent-evals.yml",
    "scripts/executor-report.mjs",
  ])("GivenMachineryPath_WhenCheckedWithMachinery_ThenRuns: %s", (path) => {
    expect(needsEvals([path], { machinery: true })).toBe(true);
    expect(needsEvals([path])).toBe(false);
  });

  it("GivenNoPaths_WhenChecked_ThenSkips", () => {
    expect(needsEvals([])).toBe(false);
  });
});
