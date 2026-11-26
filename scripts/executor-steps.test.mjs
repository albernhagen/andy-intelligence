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
    for (const step of ["refine", "plan", "review", "plan-project", "ideate", "plan-epic"]) {
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
    expect(listed).toEqual(expect.arrayContaining(["plan-project", "ideate", "plan-epic"]));
  });
});

describe("executor context step: summarize (AI-323, ADR-0137)", () => {
  it("GivenASummarizeRun_WhenTheContextIsRead_ThenItRunsWithNoTools", () => {
    const r = runContext(context("summarize", { model: "sonnet", maxTurns: 3 }));

    expect(r.status, r.log).toBe(0);
    expect(r.value("read_only")).toBe("true");
    expect(r.value("no_tools")).toBe("true");
  });

  it("GivenAnyOtherStep_WhenTheContextIsRead_ThenItKeepsItsTools", () => {
    const r = runContext(context("refine"));

    expect(r.status, r.log).toBe(0);
    expect(r.value("no_tools")).toBe("false");
  });

  it("GivenASummarizeRunWithATicketBranchOrTooManyTurns_WhenTheContextIsRead_ThenRefused", () => {
    const ticket = { projectId: "ai", key: "AI-3", title: "A story" };
    for (const over of [{ ticket }, { branch: "agent/AI-3/run1" }, { maxTurns: 4 }]) {
      const r = runContext(context("summarize", { maxTurns: 3, ...over }));

      expect(r.status, JSON.stringify(over)).not.toBe(0);
      expect(r.value("error")).toBe("GET /runs/run1/context: unexpected response shape");
    }
  });

  it("GivenTheProfile_WhenRead_ThenSummarizeIsAllowedNoTool", () => {
    const profile = JSON.parse(readFileSync(join(ROOT, "platform/executor/profile.json"), "utf8"));
    expect(profile.steps.summarize.allow).toEqual([]);
    expect(profile.steps.summarize.deny).toEqual(
      expect.arrayContaining(["Read", "Glob", "Grep", "Bash", "Edit", "Write", "WebFetch", "Task"]),
    );
  });

  it("GivenTheProcedure_WhenLoaded_ThenItHasASchemaWithNoSingleQuote", () => {
    const dir = join(ROOT, "platform/procedures");
    const schema = readFileSync(join(dir, "summarize.schema.json"), "utf8");
    expect(schema).not.toContain("'");
    expect(JSON.parse(schema).required).toEqual(["summary", "summaryRefs", "lines"]);
    expect(readFileSync(join(dir, "summarize.md"), "utf8")).toContain("untrusted data");
  });
});
