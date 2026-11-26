import { describe, expect, it } from "vitest";
import { WORKFLOW, runContext } from "./executor-workflow-testlib.mjs";

/**
 * AI-386 (ADR-0156): the executor steps around a build's plan-named packages, in
 * `.github/workflows/claude-executor.yml`. The context step runs as written; the jobs and their
 * order are checked as text.
 */

const LINES = WORKFLOW.split("\n");
function jobBlock(name) {
  const jobsAt = LINES.findIndex((l) => l === "jobs:");
  const start = LINES.findIndex((l, i) => i > jobsAt && l === `  ${name}:`);
  if (start < 0) throw new Error(`no job "${name}"`);
  let end = start + 1;
  while (end < LINES.length && !/^ {2}[a-z][\w-]*:$/.test(LINES[end])) end++;
  return LINES.slice(start, end).join("\n");
}

const zod = { name: "zod", kind: "runtime", workspace: ".", why: "Parses input." };
const build = (over = {}) => ({
  runId: "run1",
  step: "build",
  model: "sonnet",
  maxTurns: 50,
  prompt: "Do the ticket.",
  ticket: { projectId: "ai", key: "AI-3", title: "A story" },
  branch: "agent/AI-3/run1",
  sync: null,
  ...over,
});

describe("executor context step: plan packages (AI-386)", () => {
  it("GivenABuildWithPackages_WhenTheContextIsRead_ThenTheyAreAnOutputWithoutTheirReasons", () => {
    const r = runContext(
      build({ packages: [zod, { ...zod, name: "@s/x", kind: "dev", workspace: "apps/web" }] }),
    );
    expect(r.status, r.log).toBe(0);
    expect(JSON.parse(r.value("packages"))).toEqual([
      { name: "zod", kind: "runtime", workspace: "." },
      { name: "@s/x", kind: "dev", workspace: "apps/web" },
    ]);
  });

  it("GivenNoPackages_WhenTheContextIsRead_ThenTheOutputIsAnEmptyList", () => {
    for (const context of [build(), build({ packages: [] })]) {
      const r = runContext(context);
      expect(r.status, r.log).toBe(0);
      expect(r.value("packages")).toBe("[]");
    }
  });

  it("GivenAPackageTheSchemaWouldRefuse_WhenTheContextIsRead_ThenTheRunStops", () => {
    const bad = [
      [{ ...zod, name: "zod@3" }],
      [{ ...zod, name: "--registry=https://evil.test" }],
      [{ ...zod, workspace: "../x" }],
      [{ ...zod, workspace: "/etc" }],
      [{ ...zod, kind: "peer" }],
      Array.from({ length: 6 }, (_, i) => ({ ...zod, name: `p${i}` })),
    ];
    for (const packages of bad) {
      const r = runContext(build({ packages }));
      expect(r.status, JSON.stringify(packages)).not.toBe(0);
      expect(r.value("packages")).toBeUndefined();
    }
  });

  it("GivenPackagesOnAStepOtherThanBuild_WhenTheContextIsRead_ThenTheRunStops", () => {
    const r = runContext(build({ step: "plan", branch: null, packages: [zod] }));
    expect(r.status).not.toBe(0);
  });
});

describe("executor deps job (AI-386)", () => {
  const deps = jobBlock("deps");

  it("GivenTheDepsJob_WhenRead_ThenItHoldsNoCredentialOidcOrWriteToken", () => {
    expect(deps).toMatch(/permissions:\n {6}contents: read #/);
    expect(deps).not.toMatch(/id-token|environment:|secrets\.|: write/);
    expect(deps).toContain("persist-credentials: false");
    expect(deps).toContain("if: needs.context.outputs.step == 'build'");
  });

  it("GivenTheDepsJob_WhenRead_ThenTheTrustedScriptRunsFromThePlatformNotTheProject", () => {
    expect(deps).toContain('mv .executor-platform "$RUNNER_TEMP/platform"');
    expect(deps).toContain('node "$RUNNER_TEMP/platform/scripts/executor-deps.mjs" add');
    // The packages travel in env, never inside the script.
    expect(deps).toContain("PACKAGES: ${{ needs.context.outputs.packages }}");
    expect(deps).not.toMatch(/run: [^\n]*\$\{\{/);
  });

  it("GivenTheAgentJob_WhenRead_ThenItWaitsForDepsAndNeverRunsAfterItFailed", () => {
    const agent = jobBlock("agent");
    expect(agent).toContain("needs: [context, deps]");
    expect(agent).toContain("(needs.deps.result == 'success' || needs.deps.result == 'skipped')");
  });

  it("GivenTheAgentJob_WhenRead_ThenThePackagesAreAppliedAfterThePristineCopyAndBeforeTheInstall", () => {
    const agent = jobBlock("agent");
    const at = (s) => agent.indexOf(s);
    expect(at('cp -a .git "$RUNNER_TEMP/pristine.git"')).toBeGreaterThan(0);
    expect(at("- name: Apply the plan's packages (build)")).toBeGreaterThan(
      at('cp -a .git "$RUNNER_TEMP/pristine.git"'),
    );
    expect(at("- name: Install dependencies (build)")).toBeGreaterThan(
      at("- name: Apply the plan's packages (build)"),
    );
    // The agent itself (the last claude-code-action; the first is the sandbox check) comes after.
    expect(agent.lastIndexOf("uses: anthropics/claude-code-action")).toBeGreaterThan(
      at("- name: Install dependencies (build)"),
    );
  });

  it("GivenTheReportJob_WhenDepsFailed_ThenItReportsWhyTheBuildDidNotStart", () => {
    const report = jobBlock("report");
    expect(report).toContain("needs: [context, deps, agent, publish]");
    expect(report).toContain("DEPS_ERROR: ${{ needs.deps.outputs.error }}");
    expect(report).toContain(
      "Couldn't install the packages the plan names, so the build didn't start",
    );
  });
});
