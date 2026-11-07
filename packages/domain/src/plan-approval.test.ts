import {
  InMemoryCodeHost,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type NewTicket,
  type PlanApproval,
  type Run,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { MAX_PLAN_RUNS_PER_TICKET } from "./plans";
import { RunService, type RunResult } from "./runs";
import { WorkflowExecutor, buildOutput } from "./test-executor";
import type { DomainError } from "./tickets";

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const planOutput = { summary: "Adds the board page.", plan: buildOutput.plan };
const ANDY = { actor: "andy" as const, email: "andy@example.com" };

/** M1.8a: Plan approval (ADR-0050): plan runs, Andy's decision, and the dispatcher around them. */
describe("plan approval", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let runs: RunService;
  let dispatcher: BuildDispatcher;
  let projectId: string;
  let ms: number;
  const now = () => new Date((ms += 1000));

  const rejects = (p: Promise<unknown>, code: DomainError["code"]) =>
    expect(p).rejects.toMatchObject({ name: "DomainError", code });
  const policy = (planApproval: PlanApproval) => tracker.updateProject(projectId, { planApproval });
  const inReady = async (extra: Partial<NewTicket> = {}) => {
    const t = await tracker.createTicket(
      projectId,
      {
        type: "feature",
        title: "Board",
        body: "Andy can't see his tickets.",
        acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
        size: "M",
        sizeReason: "one screen and its API",
        ...extra,
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
  const report = async (run: Run, result: Partial<RunResult> = {}) => {
    await runs.context(run.id, run.executor!);
    return runs.report(run.id, run.executor!, {
      status: "succeeded",
      summary: "done",
      output: run.step === "plan" ? planOutput : buildOutput,
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: 0.42,
      ...result,
    });
  };
  const ticketOf = async (id: string) => (await tracker.getTicket(projectId, id))!;
  const runsOf = async (id: string) => runStore.listForTicket(projectId, id);
  /** A plan run reported and awaiting Andy. */
  const planned = async (extra: Partial<NewTicket> = {}) => {
    const ticket = await inReady(extra);
    const plan = await runs.start(projectId, ticket.id, "build");
    await report(plan);
    return { ticket, plan: (await runStore.get(plan.id))! };
  };

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ms = Date.parse("2026-11-06T12:00:00.000Z");
    tracker = new InMemoryWorkTracker(now);
    runStore = new InMemoryRunStore(now);
    runs = new RunService(
      tracker,
      runStore,
      new WorkflowExecutor(new InMemoryCodeHost([REPO])),
      now,
      null,
      async (p) => {
        await dispatcher.next(p);
      },
    );
    dispatcher = new BuildDispatcher(tracker, runStore, runs, now);
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, { autoRefine: false, buildEnabled: true });
    await policy("all");
  });

  it("GivenPolicyAll_WhenABuildIsStarted_ThenAReadOnlyPlanRunStartsInstead", async () => {
    const ticket = await inReady();
    const run = await runs.start(projectId, ticket.id, "build");
    expect(run).toMatchObject({ step: "plan", tier: "strong", maxTurns: 50 });
    expect(run.prompt).toContain("You are the plan step");
    // A plan run leaves the ticket in Ready: only a build moves it.
    expect((await ticketOf(ticket.id)).stage).toBe("ready");
  });

  it("GivenPolicyNone_WhenABuildIsStarted_ThenTheBuildStartsWithoutAPlan", async () => {
    await policy("none");
    const ticket = await inReady();
    expect(await runs.start(projectId, ticket.id, "build")).toMatchObject({
      step: "build",
      planRunId: null,
    });
  });

  it("GivenPolicyMAndL_WhenSAndMTicketsAreStarted_ThenOnlyTheMTicketIsPlanned", async () => {
    await policy("m-and-l");
    const small = await inReady({ size: "S", sizeReason: "one line" });
    expect((await runs.start(projectId, small.id, "build")).step).toBe("build");
    await report((await runsOf(small.id))[0]!, { status: "failed" });
    const [retry] = await runsOf(small.id);
    await runs.cancelForTicket(projectId, small.id);
    expect(retry!.step).toBe("build");
    const medium = await inReady();
    expect((await runs.start(projectId, medium.id, "build")).step).toBe("plan");
  });

  it("GivenAPlanReport_WhenRecorded_ThenThePlanIsStoredTheTicketFlaggedAndNothingStarts", async () => {
    const { ticket, plan } = await planned();
    expect(plan).toMatchObject({ status: "succeeded", plan: buildOutput.plan, planDecision: null });
    expect(plan.summary).toContain("Adds the board page.");
    expect((await ticketOf(ticket.id)).needsAttention).toBe(true);
    expect(await runsOf(ticket.id)).toHaveLength(1);
    const events = await tracker.listEvents(projectId, ticket.id);
    expect(events.some((e) => e.body?.includes("approve or reject this plan"))).toBe(true);
  });

  it("GivenAMalformedPlanReport_WhenRecorded_ThenTheRunFailsAndTheTicketIsFlagged", async () => {
    const ticket = await inReady();
    const plan = await runs.start(projectId, ticket.id, "build");
    await report(plan, { output: { summary: "no plan" } });
    expect(await runStore.get(plan.id)).toMatchObject({ status: "failed", plan: null });
    expect((await ticketOf(ticket.id)).needsAttention).toBe(true);
  });

  it("GivenAnAwaitingPlan_WhenAndyApproves_ThenTheBuildStartsWithThePlanInItsPrompt", async () => {
    const { ticket, plan } = await planned();
    const result = await runs.decidePlan(
      projectId,
      ticket.id,
      plan.id,
      { decision: "approved" },
      ANDY,
    );
    expect(result.run.planDecision).toMatchObject({
      decision: "approved",
      by: "andy@example.com",
      at: expect.any(String),
    });
    expect(result.build).toMatchObject({ step: "build", planRunId: plan.id });
    expect(result.build!.prompt).toContain("<approved-plan>");
    expect(result.build!.prompt).toContain("Ordering by rank");
    expect(await ticketOf(ticket.id)).toMatchObject({
      stage: "in_progress",
      needsAttention: false,
    });
  });

  it("GivenAnApprovedPlan_WhenItsBuildCantStartNow_ThenTheApprovalStandsForTheNextStart", async () => {
    const { ticket, plan } = await planned();
    const other = await inReady({ title: "Other" });
    await runs.start(projectId, other.id, "build");
    const result = await runs.decidePlan(
      projectId,
      ticket.id,
      plan.id,
      { decision: "approved" },
      ANDY,
    );
    expect(result).toMatchObject({ build: null, buildError: expect.stringContaining("in flight") });
    // Still in Needs-you until the build starts.
    expect((await ticketOf(ticket.id)).needsAttention).toBe(true);
    await runs.cancelForTicket(projectId, other.id);
    expect(await runs.start(projectId, ticket.id, "build")).toMatchObject({
      step: "build",
      planRunId: plan.id,
    });
  });

  it("GivenAnAwaitingPlan_WhenAndyRejectsWithAReason_ThenItIsRecordedAndNoBuildStarts", async () => {
    const { ticket, plan } = await planned();
    const result = await runs.decidePlan(
      projectId,
      ticket.id,
      plan.id,
      { decision: "rejected", reason: "Split the API out first." },
      ANDY,
    );
    expect(result).toMatchObject({
      build: null,
      run: { planDecision: { decision: "rejected", reason: "Split the API out first." } },
    });
    expect(await ticketOf(ticket.id)).toMatchObject({ stage: "ready", needsAttention: true });
    expect(await runsOf(ticket.id)).toHaveLength(1);
    const events = await tracker.listEvents(projectId, ticket.id);
    expect(events.some((e) => e.body?.includes("Split the API out first."))).toBe(true);
  });

  it("GivenARejectedPlan_WhenAndyStartsAgain_ThenTheNewPlanRunSeesTheReason", async () => {
    const { ticket, plan } = await planned();
    await runs.decidePlan(
      projectId,
      ticket.id,
      plan.id,
      { decision: "rejected", reason: "Split the API out first." },
      ANDY,
    );
    const replan = await runs.start(projectId, ticket.id, "build");
    expect(replan.step).toBe("plan");
    expect(replan.prompt).toContain("<rejected-plans>");
    expect(replan.prompt).toContain("Split the API out first.");
  });

  it("GivenARejectionWithoutAReason_WhenDecided_ThenItIsRefused", async () => {
    const { ticket, plan } = await planned();
    await rejects(
      runs.decidePlan(projectId, ticket.id, plan.id, { decision: "rejected", reason: " " }, ANDY),
      "plan_not_decidable",
    );
  });

  it.each(["system", "agent:run-1"])(
    "GivenActor%s_WhenItApprovesOrRejects_ThenItIsForbiddenAndNothingIsRecorded",
    async (actor) => {
      const { ticket, plan } = await planned();
      const as = { actor, email: "andy@example.com" };
      await rejects(
        runs.decidePlan(projectId, ticket.id, plan.id, { decision: "approved" }, as),
        "forbidden",
      );
      await rejects(
        runs.decidePlan(projectId, ticket.id, plan.id, { decision: "rejected", reason: "x" }, as),
        "forbidden",
      );
      expect((await runStore.get(plan.id))!.planDecision).toBeNull();
    },
  );

  it("GivenTwoConcurrentDecisions_WhenBothRace_ThenOneWinsAndTheOtherIsRefused", async () => {
    const { ticket, plan } = await planned();
    const results = await Promise.allSettled([
      runs.decidePlan(projectId, ticket.id, plan.id, { decision: "approved" }, ANDY),
      runs.decidePlan(projectId, ticket.id, plan.id, { decision: "rejected", reason: "no" }, ANDY),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ code: "plan_not_decidable" });
    const stored = (await runStore.get(plan.id))!.planDecision!;
    const winner = (won[0] as PromiseFulfilledResult<{ run: Run; build: Run | null }>).value;
    expect(stored).toEqual(winner.run.planDecision);
    // An approval that won started its build; a rejection that won started nothing.
    const builds = (await runsOf(ticket.id)).filter((r) => r.step === "build");
    expect(builds).toHaveLength(stored.decision === "approved" ? 1 : 0);
  });

  it("GivenADecidedPlan_WhenDecidedAgain_ThenItIsRefused", async () => {
    const { ticket, plan } = await planned();
    await runs.decidePlan(
      projectId,
      ticket.id,
      plan.id,
      { decision: "rejected", reason: "no" },
      ANDY,
    );
    await rejects(
      runs.decidePlan(projectId, ticket.id, plan.id, { decision: "approved" }, ANDY),
      "plan_not_decidable",
    );
  });

  it("GivenTheTicketChangedAfterThePlan_WhenAndyApproves_ThenItIsRefusedAsStale", async () => {
    const { ticket, plan } = await planned();
    await tracker.updateTicket(projectId, ticket.id, { fields: { body: "Changed." } }, "andy");
    await rejects(
      runs.decidePlan(projectId, ticket.id, plan.id, { decision: "approved" }, ANDY),
      "plan_not_decidable",
    );
    // Rejecting a stale plan is still allowed, and so is a new plan run.
    expect((await runs.start(projectId, ticket.id, "build")).step).toBe("plan");
  });

  it("GivenThePolicyChangedToNone_WhenAPlanAwaits_ThenItIsStaleAndTheBuildStartsWithoutIt", async () => {
    const { ticket, plan } = await planned();
    expect(plan.planPolicy).toBe("all");
    await policy("none");
    await rejects(
      runs.decidePlan(projectId, ticket.id, plan.id, { decision: "approved" }, ANDY),
      "plan_not_decidable",
    );
    expect(await runs.start(projectId, ticket.id, "build")).toMatchObject({
      step: "build",
      planRunId: null,
    });
  });

  it("GivenAReportedPlanFailure_WhenItsRetryFailsToo_ThenTheTicketIsFlaggedAndNoBuildStarts", async () => {
    const ticket = await inReady();
    const plan = await runs.start(projectId, ticket.id, "build");
    await report(plan, { status: "failed" });
    const [retry] = await runsOf(ticket.id);
    expect(retry).toMatchObject({ step: "plan", attempt: 2 });
    await report(retry!, { status: "failed" });
    expect((await ticketOf(ticket.id)).needsAttention).toBe(true);
    expect((await runsOf(ticket.id)).every((r) => r.step === "plan")).toBe(true);
  });

  it("GivenAFlagOrRankChangeOnly_WhenAndyApproves_ThenThePlanIsStillFresh", async () => {
    const { ticket, plan } = await planned();
    await tracker.updateTicket(projectId, ticket.id, { fields: { rank: "0000000000" } }, "andy");
    const result = await runs.decidePlan(
      projectId,
      ticket.id,
      plan.id,
      { decision: "approved" },
      ANDY,
    );
    expect(result.build?.step).toBe("build");
  });

  it("GivenAnAwaitingPlan_WhenABuildIsStarted_ThenItIsRefused", async () => {
    const { ticket } = await planned();
    await rejects(runs.start(projectId, ticket.id, "build"), "not_buildable");
  });

  it("GivenAPlanThatIsNotTheLatest_WhenAndyApproves_ThenItIsRefused", async () => {
    const { ticket, plan } = await planned();
    const second = await runs.start(projectId, ticket.id, "plan");
    await report(second);
    await rejects(
      runs.decidePlan(projectId, ticket.id, plan.id, { decision: "approved" }, ANDY),
      "plan_not_decidable",
    );
  });

  it("GivenATicketAtItsPlanCap_WhenAPlanIsStarted_ThenItIsRefused", async () => {
    const ticket = await inReady();
    for (let i = 0; i < MAX_PLAN_RUNS_PER_TICKET; i++) {
      const plan = await runs.start(projectId, ticket.id, "plan");
      await runs.cancelForTicket(projectId, ticket.id);
      expect(plan.step).toBe("plan");
    }
    await rejects(runs.start(projectId, ticket.id, "plan"), "run_limit");
  });

  describe("dispatcher", () => {
    beforeEach(async () => {
      await tracker.updateProject(projectId, { autoBuild: true });
    });

    it("GivenAReadyTicketThatNeedsAPlan_WhenNext_ThenItsPlanRunStarts", async () => {
      const ticket = await inReady();
      expect(await dispatcher.next(projectId)).toMatchObject({
        step: "plan",
        ticketId: ticket.id,
      });
    });

    it("GivenAPlanAwaitingADecision_WhenNext_ThenThatTicketIsSkippedEvenUnflagged", async () => {
      const { ticket } = await planned();
      // Andy clears the flag without deciding: the plan still waits.
      await tracker.updateTicket(
        projectId,
        ticket.id,
        { fields: { needsAttention: false } },
        "andy",
      );
      const other = await inReady({ title: "Other", size: "S", sizeReason: "one line" });
      const run = await dispatcher.next(projectId);
      expect(run).toMatchObject({ ticketId: other.id, step: "plan" });
      expect(await runsOf(ticket.id)).toHaveLength(1);
    });

    it("GivenARejectedPlan_WhenNext_ThenTheTicketWaitsForAndyEvenUnflagged", async () => {
      const { ticket, plan } = await planned();
      await runs.decidePlan(
        projectId,
        ticket.id,
        plan.id,
        { decision: "rejected", reason: "no" },
        ANDY,
      );
      await tracker.updateTicket(
        projectId,
        ticket.id,
        { fields: { needsAttention: false } },
        "andy",
      );
      expect(await dispatcher.next(projectId)).toBeNull();
    });

    it("GivenAnApprovedPlanWhoseBuildWaited_WhenNext_ThenTheBuildStartsWithThePlan", async () => {
      const { ticket, plan } = await planned();
      await runStore.update(
        plan.id,
        {
          planDecision: {
            decision: "approved",
            reason: null,
            by: "andy@example.com",
            at: now().toISOString(),
          },
        },
        ["succeeded"],
      );
      await tracker.updateTicket(
        projectId,
        ticket.id,
        { fields: { needsAttention: false } },
        "andy",
      );
      expect(await dispatcher.next(projectId)).toMatchObject({
        step: "build",
        planRunId: plan.id,
      });
    });

    it("GivenATicketAtItsPlanCap_WhenNext_ThenItIsFlaggedNotStarted", async () => {
      const ticket = await inReady();
      for (let i = 0; i < MAX_PLAN_RUNS_PER_TICKET; i++) {
        await runs.start(projectId, ticket.id, "plan");
        await runs.cancelForTicket(projectId, ticket.id);
      }
      expect(await dispatcher.next(projectId)).toBeNull();
      expect((await ticketOf(ticket.id)).needsAttention).toBe(true);
    });
  });
});
