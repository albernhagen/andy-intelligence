import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, runContext, stepScript } from "./executor-workflow-testlib.mjs";

/**
 * AI-134: the executor's step list. The context step of `.github/workflows/claude-executor.yml`
 * is run as written: the read-only steps (plan-project and ideate among them) get read-only
 * tools, build and sync don't, and any other step is refused before the agent job.
 */

const context = (step, over = {}) => ({
  runId: "run1",
  step,
  model: "opus",
  maxTurns: 40,
  prompt: "Project AI. (untrusted text)",
  ticket: null,
  branch: null,
  sync: null,
  ...over,
});

describe("executor context step: step list (AI-134)", () => {
  it("GivenAReadOnlyStep_WhenTheContextIsRead_ThenItRunsReadOnly", () => {
    for (const step of ["refine", "plan", "review", "plan-project", "ideate"]) {
      const r = runContext(context(step));

      expect(r.status, `${step}: ${r.log}`).toBe(0);
      expect(r.value("step")).toBe(step);
      expect(r.value("read_only"), step).toBe("true");
    }
  });

  it("GivenABuild_WhenTheContextIsRead_ThenItIsNotReadOnly", () => {
    const r = runContext(
      context("build", {
        ticket: { projectId: "ai", key: "AI-3", title: "A story" },
        branch: "agent/AI-3/run1",
      }),
    );

    expect(r.status, r.log).toBe(0);
    expect(r.value("read_only")).toBe("false");
  });

  it("GivenAStepNotOnTheList_WhenTheContextIsRead_ThenTheRunIsRefusedWithNoOutputs", () => {
    for (const step of ["verify", "scout", "deploy", "plan-projects", "ideate-x"]) {
      const r = runContext(context(step));

      expect(r.status, step).not.toBe(0);
      expect(r.value("error"), step).toBe(
        `step ${step} is not one this executor runs: refusing it`,
      );
      expect(r.value("read_only"), step).toBeUndefined();
      expect(r.value("step"), step).toBeUndefined();
    }
  });

  it("GivenTheWorkflowAndTheProfile_WhenRead_ThenEveryReadOnlyStepHasReadOnlyRules", () => {
    const script = stepScript("Validate inputs and fetch the run context");
    const listed = script
      .match(/^\s*([a-z| -]+)\) read_only=true ;;$/m)[1]
      .split("|")
      .map((s) => s.trim());
    const profile = JSON.parse(readFileSync(join(ROOT, "platform/executor/profile.json"), "utf8"));
    for (const step of listed) {
      expect(profile.steps[step]?.allow, step).toEqual(["Read", "Glob", "Grep"]);
      expect(profile.steps[step]?.deny, step).toEqual(
        expect.arrayContaining(["Bash", "Edit", "Write", "WebFetch"]),
      );
    }
    expect(listed).toEqual(expect.arrayContaining(["plan-project", "ideate"]));
  });
});
