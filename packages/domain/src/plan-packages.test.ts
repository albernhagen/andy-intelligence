import {
  InMemoryCodeHost,
  InMemoryRunStore,
  InMemoryWorkTracker,
  PACKAGE_LIMITS,
  type PlanApproval,
  type PlanPackage,
  type Run,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { packagesNeeded, planPrompt, renderPlan } from "./plans";
import { RunService, checkPlanPackages, type RunResult } from "./runs";
import { WorkflowExecutor, buildOutput } from "./test-executor";

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const ANDY = { actor: "andy" as const, email: "andy@example.com" };
const ZOD: PlanPackage = { name: "zod", kind: "runtime", workspace: ".", why: "Parses input." };
const planWith = (packages: PlanPackage[]) => ({
  summary: "Adds the board page.",
  plan: { ...buildOutput.plan, packages },
});

/** AI-386: packages a plan names, installed outside the sandbox before the build (ADR-0156). */
describe("plan packages", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let runs: RunService;
  let projectId: string;
  let ms: number;
  const now = () => new Date((ms += 1000));

  const policy = (planApproval: PlanApproval) => tracker.updateProject(projectId, { planApproval });
  const inReady = async () => {
    const t = await tracker.createTicket(
      projectId,
      {
        type: "feature",
        title: "Board",
        body: "Andy can't see his tickets.",
        acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
        size: "M",
        sizeReason: "one screen and its API",
      },
      "andy",
    );
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };
  const report = async (run: Run, output: unknown, result: Partial<RunResult> = {}) => {
    await runs.context(run.id, run.executor!);
    return runs.report(run.id, run.executor!, {
      status: "succeeded",
      summary: "done",
      output,
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: 0.42,
      ...result,
    });
  };
  const runsOf = async (id: string) => runStore.listForTicket(projectId, id);
  const events = async (id: string) =>
    (await tracker.listEvents(projectId, id)).map((e) => e.body ?? "").join("\n");
  /** A ticket whose plan named `packages`, approved by Andy; returns the build it started. */
  const approvedBuild = async (packages: PlanPackage[]) => {
    const ticket = await inReady();
    const plan = await runs.start(projectId, ticket.id, "build");
    await report(plan, planWith(packages));
    const { build } = await runs.decidePlan(
      projectId,
      ticket.id,
      plan.id,
      { decision: "approved" },
      ANDY,
    );
    return { ticket, plan, build: build! };
  };

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ms = Date.parse("2026-11-25T12:00:00.000Z");
    tracker = new InMemoryWorkTracker(now);
    runStore = new InMemoryRunStore(now);
    runs = new RunService(
      tracker,
      runStore,
      new WorkflowExecutor(new InMemoryCodeHost([REPO])),
      now,
    );
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, { autoRefine: false, buildEnabled: true });
    await policy("all");
  });

  it("GivenAPlanNamingPackages_WhenRecorded_ThenAndySeesThemInThePlan", async () => {
    const ticket = await inReady();
    const plan = await runs.start(projectId, ticket.id, "build");
    await report(plan, planWith([ZOD]));
    const stored = (await runStore.get(plan.id))!;
    expect(stored.plan?.packages).toEqual([ZOD]);
    expect(stored.summary).toContain("zod (runtime, .): Parses input.");
  });

  it("GivenAPlanNamingMorePackagesThanTheCap_WhenRecorded_ThenThePlanIsRejectedAndTheTicketSaysWhy", async () => {
    const ticket = await inReady();
    const plan = await runs.start(projectId, ticket.id, "build");
    const many = Array.from({ length: PACKAGE_LIMITS.maxPackages + 1 }, (_, i) => ({
      ...ZOD,
      name: `p${i}`,
    }));
    await report(plan, planWith(many));
    expect((await runStore.get(plan.id))!).toMatchObject({ status: "failed", plan: null });
    expect(await events(ticket.id)).toContain("plan.packages");
    expect((await tracker.getTicket(projectId, ticket.id))!.needsAttention).toBe(true);
  });

  it("GivenAnApprovedPlanWithPackages_WhenTheBuildAsksForItsContext_ThenItGetsThePackages", async () => {
    const { build } = await approvedBuild([ZOD]);
    expect(build.step).toBe("build");
    expect((await runs.context(build.id, build.executor!)).packages).toEqual([ZOD]);
  });

  it("GivenABuildWithoutAPlan_WhenItAsksForItsContext_ThenItGetsNoPackages", async () => {
    await policy("none");
    const ticket = await inReady();
    const build = await runs.start(projectId, ticket.id, "build");
    expect((await runs.context(build.id, build.executor!)).packages).toEqual([]);
  });

  it("GivenABuildThatNeedsAnUnnamedPackage_WhenReported_ThenItFailsAndTheTicketNamesThePackage", async () => {
    const { ticket, build } = await approvedBuild([]);
    await report(build, { ...buildOutput, neededPackages: ["date-fns"] });
    const done = (await runStore.get(build.id))!;
    expect(done).toMatchObject({ status: "failed", neededPackages: ["date-fns"] });
    expect(done.error).toContain("date-fns");
    expect(await events(ticket.id)).toContain(
      "Needs you: the build needs packages its plan didn't name: date-fns",
    );
    expect((await tracker.getTicket(projectId, ticket.id))!.needsAttention).toBe(true);
  });

  it("GivenABuildThatNeededPackages_WhenStartedAgain_ThenANewPlanRunNamesThemInItsPrompt", async () => {
    const { ticket, build } = await approvedBuild([]);
    await report(build, { ...buildOutput, neededPackages: ["date-fns"] });
    const next = await runs.start(projectId, ticket.id, "build");
    expect(next.step).toBe("plan");
    expect(next.prompt).toContain("<packages-the-last-build-needed>");
    expect(next.prompt).toContain("date-fns");
  });

  it("GivenPolicyNoneAndABuildThatNeededPackages_WhenStartedAgain_ThenAPlanRunGoesFirst", async () => {
    await policy("none");
    const ticket = await inReady();
    const build = await runs.start(projectId, ticket.id, "build");
    await report(build, { ...buildOutput, neededPackages: ["date-fns"] });
    expect((await runs.start(projectId, ticket.id, "build")).step).toBe("plan");
  });

  it("GivenANewPlanAfterTheBuildThatNeededPackages_WhenChecked_ThenNothingIsNeededAnyMore", async () => {
    const { ticket, build } = await approvedBuild([]);
    await report(build, { ...buildOutput, neededPackages: ["date-fns"] });
    expect(packagesNeeded(await runsOf(ticket.id))).toEqual(["date-fns"]);
    const plan = await runs.start(projectId, ticket.id, "build");
    expect(packagesNeeded(await runsOf(ticket.id))).toEqual([]);
    await report(plan, planWith([{ ...ZOD, name: "date-fns" }]));
    const { build: next } = await runs.decidePlan(
      projectId,
      ticket.id,
      plan.id,
      { decision: "approved" },
      ANDY,
    );
    expect(next?.step).toBe("build");
  });
});

describe("checkPlanPackages (AI-386)", () => {
  const ticket = { key: "AI-1" };
  const approved = (packages: PlanPackage[]) =>
    ({ plan: { ...buildOutput.plan, packages } }) as unknown as Run;

  it("GivenNoApprovedPlanOrNoPackages_WhenChecked_ThenTheBuildMayStart", () => {
    expect(() => checkPlanPackages(ticket, null, true)).not.toThrow();
    expect(() => checkPlanPackages(ticket, approved([]), true)).not.toThrow();
  });

  it("GivenPackagesOverTheCap_WhenChecked_ThenTheBuildIsRefused", () => {
    const many = Array.from({ length: PACKAGE_LIMITS.maxPackages + 1 }, (_, i) => ({
      ...ZOD,
      name: `p${i}`,
    }));
    expect(() => checkPlanPackages(ticket, approved(many), false)).toThrow(/can't install/);
  });

  it("GivenPackagesOnTheLocalRunner_WhenChecked_ThenTheBuildIsRefused", () => {
    expect(() => checkPlanPackages(ticket, approved([ZOD]), true)).toThrow(/local runner/);
    expect(() => checkPlanPackages(ticket, approved([ZOD]), false)).not.toThrow();
  });
});

describe("planPrompt and renderPlan (AI-386)", () => {
  it("GivenAPlanWithoutPackages_WhenRendered_ThenItSaysNone", () => {
    expect(renderPlan(planWith([]))).toContain("Packages to install before the build");
    expect(renderPlan(planWith([]))).toMatch(/install scripts off\):\n- none/);
  });

  it("GivenNoBuildNeededPackages_WhenThePlanPromptIsBuilt_ThenItHasNoPackagesBlock", () => {
    const ticket = {
      key: "AI-1",
      title: "t",
      body: "b",
      acceptanceCriteria: [],
      type: "feature",
    } as unknown as Parameters<typeof planPrompt>[0];
    expect(planPrompt(ticket, "o/r", [], [])).not.toContain("packages-the-last-build-needed");
  });
});
