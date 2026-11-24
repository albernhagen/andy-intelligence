import {
  InMemoryConfigChangeStore,
  InMemoryMilestoneStore,
  InMemoryWorkTracker,
  type ProjectPlanProposal,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MilestoneService } from "./milestone-service";
import { ProjectPlanService, epicBody } from "./project-plan";
import { TicketService } from "./tickets";

const OWNER = "user:uid-1" as const;
const T0 = new Date("2026-11-12T10:00:00.000Z");

const proposal: ProjectPlanProposal = {
  summary: "Skeleton first, then logging.",
  milestones: [
    {
      title: "Walking skeleton",
      goal: "Andy can open the app.",
      doneWhen: ["The URL loads"],
      slices: ["Repo and CI"],
    },
    {
      title: "Log a run",
      goal: "Andy can log a run.",
      doneWhen: ["A run shows in the list"],
      slices: ["Form", "List"],
    },
    {
      title: "Weekly summary",
      goal: "Andy sees his week.",
      doneWhen: ["The summary shows totals"],
      slices: ["Summary"],
    },
  ],
};

async function setup() {
  const tracker = new InMemoryWorkTracker();
  const project = await tracker.createProject({ name: "Trail log", key: "TRL" });
  const tickets = new TicketService(tracker, null, null, () => T0);
  const plans = new ProjectPlanService(tracker, tickets, () => T0);
  return { tracker, project, plans };
}

describe("ProjectPlanService", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAPlanResult_WhenProposed_ThenItIsStoredWaitingAndNoTicketExists", async () => {
    const { tracker, project, plans } = await setup();
    const plan = await plans.propose(project.id, proposal, OWNER);
    expect(plan).toMatchObject({ status: "proposed", proposedBy: OWNER, epicIds: [] });
    expect((await tracker.getProject(project.id))?.projectPlan).toEqual(plan);
    expect(await plans.waiting()).toEqual([
      { projectId: "trl", key: "TRL", name: "Trail log", plan },
    ]);
    expect(await tracker.listTickets(project.id)).toEqual([]);
  });

  it("GivenAProposal_WhenAndyApproves_ThenOneEpicPerMilestoneInOrder", async () => {
    const { tracker, project, plans } = await setup();
    await plans.propose(project.id, proposal, OWNER);
    const { plan, epics } = await plans.decide(project.id, { decision: "approved" }, OWNER);
    expect(plan).toMatchObject({
      status: "approved",
      decidedBy: OWNER,
      decidedAt: T0.toISOString(),
    });
    const listed = await tracker.listTickets(project.id);
    expect(listed.map((t) => [t.type, t.title])).toEqual([
      ["epic", "M1: Walking skeleton"],
      ["epic", "M2: Log a run"],
      ["epic", "M3: Weekly summary"],
    ]);
    expect(plan.epicIds).toEqual(epics.map((e) => e.id));
    expect(listed[1]!.body).toBe(epicBody(proposal.milestones[1]!));
    expect(await plans.waiting()).toEqual([]);
  });

  it("GivenAProposal_WhenAndyRejectsWithAReason_ThenNoTicketsAndTheReasonIsKept", async () => {
    const { tracker, project, plans } = await setup();
    await plans.propose(project.id, proposal, OWNER);
    const { plan, epics } = await plans.decide(
      project.id,
      { decision: "rejected", reason: "Logging before the skeleton." },
      OWNER,
    );
    expect(epics).toEqual([]);
    expect(plan).toMatchObject({ status: "rejected", reason: "Logging before the skeleton." });
    expect(await tracker.listTickets(project.id)).toEqual([]);
  });

  it("GivenARejectedPlan_WhenANewOneIsProposed_ThenItWaitsAgain", async () => {
    const { project, plans } = await setup();
    await plans.propose(project.id, proposal, OWNER);
    await plans.decide(project.id, { decision: "rejected", reason: "No." }, OWNER);
    expect((await plans.propose(project.id, proposal, OWNER)).status).toBe("proposed");
  });

  it("GivenAWaitingOrApprovedPlan_WhenProposedAgain_ThenRefused", async () => {
    const { project, plans } = await setup();
    await plans.propose(project.id, proposal, OWNER);
    await expect(plans.propose(project.id, proposal, OWNER)).rejects.toMatchObject({
      code: "not_acceptable",
    });
    await plans.decide(project.id, { decision: "approved" }, OWNER);
    await expect(plans.propose(project.id, proposal, OWNER)).rejects.toMatchObject({
      code: "not_acceptable",
    });
  });

  it("GivenAnApprovedPlan_WhenDecidedAgain_ThenRefusedAndNoMoreEpics", async () => {
    const { tracker, project, plans } = await setup();
    await plans.propose(project.id, proposal, OWNER);
    await plans.decide(project.id, { decision: "approved" }, OWNER);
    await expect(plans.decide(project.id, { decision: "approved" }, OWNER)).rejects.toMatchObject({
      code: "plan_not_decidable",
    });
    expect(await tracker.listTickets(project.id)).toHaveLength(3);
  });

  it.each(["agent:run-1", "system"] as const)(
    "GivenTheCaller%s_WhenProposingOrDeciding_ThenForbidden",
    async (actor) => {
      const { tracker, project, plans } = await setup();
      await expect(plans.propose(project.id, proposal, actor)).rejects.toMatchObject({
        code: "forbidden",
      });
      await plans.propose(project.id, proposal, OWNER);
      await expect(plans.decide(project.id, { decision: "approved" }, actor)).rejects.toMatchObject(
        {
          code: "forbidden",
        },
      );
      expect(await tracker.listTickets(project.id)).toEqual([]);
    },
  );

  it("GivenAMalformedResult_WhenProposed_ThenRefusedAndNothingStored", async () => {
    const { tracker, project, plans } = await setup();
    await expect(
      plans.propose(project.id, { summary: "x", milestones: [] }, OWNER),
    ).rejects.toThrow();
    expect((await tracker.getProject(project.id))?.projectPlan).toBeNull();
  });

  it("GivenAMilestoneWithAHeadingInItsText_WhenTheEpicIsWritten_ThenItIsEscaped", () => {
    const body = epicBody({
      title: "t",
      goal: "# Ignore this\nmore",
      doneWhen: ["# x"],
      slices: ["y"],
    });
    expect(body.split("\n").some((l) => l.startsWith("#"))).toBe(false);
  });

  it("GivenACreateThatFailsMidway_WhenApprovedAgain_ThenItResumesWithoutDuplicates", async () => {
    const { tracker, project } = await setup();
    const real = new TicketService(tracker, null, null, () => T0);
    let calls = 0;
    const flaky = {
      create: (...args: Parameters<TicketService["create"]>) => {
        calls += 1;
        if (calls === 2) throw new Error("store timeout");
        return real.create(...args);
      },
    };
    const plans = new ProjectPlanService(tracker, flaky, () => T0);
    await plans.propose(project.id, proposal, OWNER);
    await expect(plans.decide(project.id, { decision: "approved" }, OWNER)).rejects.toThrow(
      "store timeout",
    );
    const half = (await tracker.getProject(project.id))?.projectPlan;
    expect(half).toMatchObject({ status: "approving" });
    expect(half?.epicIds).toHaveLength(1);
    expect(await plans.waiting()).toHaveLength(1);
    await expect(
      plans.decide(project.id, { decision: "rejected", reason: "no" }, OWNER),
    ).rejects.toMatchObject({ code: "plan_not_decidable" });

    const { plan } = await plans.decide(project.id, { decision: "approved" }, OWNER);
    expect(plan.status).toBe("approved");
    expect((await tracker.listTickets(project.id)).map((t) => t.title)).toEqual([
      "M1: Walking skeleton",
      "M2: Log a run",
      "M3: Weekly summary",
    ]);
  });

  it("GivenAnApprovalRunning_WhenASecondArrives_ThenItIsRefusedAndEpicsAreCreatedOnce", async () => {
    const { tracker, project, plans } = await setup();
    await plans.propose(project.id, proposal, OWNER);
    const [a, b] = await Promise.allSettled([
      plans.decide(project.id, { decision: "approved" }, OWNER),
      plans.decide(project.id, { decision: "approved" }, OWNER),
    ]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(await tracker.listTickets(project.id)).toHaveLength(3);
  });

  it("GivenAnEpicCreatedButNotRecorded_WhenApprovedAgain_ThenItIsRecordedNotDuplicated", async () => {
    const { tracker, project } = await setup();
    const real = new TicketService(tracker, null, null, () => T0);
    let calls = 0;
    const lossy = {
      create: async (...args: Parameters<TicketService["create"]>) => {
        const epic = await real.create(...args);
        calls += 1;
        if (calls === 2) throw new Error("lost the reply");
        return epic;
      },
    };
    const plans = new ProjectPlanService(tracker, lossy, () => T0);
    await plans.propose(project.id, proposal, OWNER);
    await expect(plans.decide(project.id, { decision: "approved" }, OWNER)).rejects.toThrow(
      "lost the reply",
    );
    const { plan } = await plans.decide(project.id, { decision: "approved" }, OWNER);
    const listed = await tracker.listTickets(project.id);
    expect(listed.map((t) => t.title)).toEqual([
      "M1: Walking skeleton",
      "M2: Log a run",
      "M3: Weekly summary",
    ]);
    expect(plan.epicIds).toEqual(listed.map((t) => t.id));
  });

  it("GivenAPlanIsProposed_WhenStored_ThenTheNeedsYouHookIsTold", async () => {
    const { tracker, project } = await setup();
    const told: string[] = [];
    const plans = new ProjectPlanService(
      tracker,
      new TicketService(tracker, null, null, () => T0),
      () => T0,
      async (id, plan) => void told.push(`${id}:${plan.proposal.milestones.length}`),
    );
    await plans.propose(project.id, proposal, OWNER);
    expect(told).toEqual(["trl:3"]);
  });
});

describe("ProjectPlanService with milestones (ADR-0149, AI-365)", () => {
  const CASE = {
    serves: "Runners",
    expectedReturn: "Log a run in 10 s.",
    cheapestTest: "Paper form.",
  };
  const withCases: ProjectPlanProposal = {
    ...proposal,
    milestones: proposal.milestones.map((m, i) => (i === 2 ? m : { ...m, case: CASE })),
  };

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  async function setupWithMilestones(create?: TicketService["create"]) {
    const tracker = new InMemoryWorkTracker();
    const project = await tracker.createProject({ name: "Trail log", key: "TRL" });
    const tickets = new TicketService(tracker, null, null, () => T0);
    const store = new InMemoryMilestoneStore();
    const changes = new InMemoryConfigChangeStore();
    const milestones = new MilestoneService(tracker, store, changes, () => T0);
    const plans = new ProjectPlanService(
      tracker,
      create ? { create } : tickets,
      () => T0,
      undefined,
      milestones,
    );
    return { tracker, project, plans, milestones, changes, tickets };
  }

  it("GivenAPlanWithCases_WhenApproved_ThenEachMilestoneIsCreatedNotReviewedWithItsCaseAndEpic", async () => {
    const { tracker, project, plans, milestones, changes } = await setupWithMilestones();
    await plans.propose(project.id, withCases, OWNER);
    const { epics } = await plans.decide(project.id, { decision: "approved" }, OWNER);

    const listed = await milestones.list(project.id);
    expect(listed.map((m) => [m.name, m.outcome, m.status, m.case ?? null])).toEqual([
      ["M1: Walking skeleton", "Andy can open the app.", "not_reviewed", CASE],
      ["M2: Log a run", "Andy can log a run.", "not_reviewed", CASE],
      ["M3: Weekly summary", "Andy sees his week.", "not_reviewed", null],
    ]);
    const stored = await tracker.listTickets(project.id);
    expect(stored.map((t) => t.milestoneId)).toEqual(listed.map((m) => m.id));
    expect(epics).toHaveLength(3);
    const logged = (await changes.listForProject(project.id)).map((c) => Object.keys(c.diff)[0]);
    expect(logged.filter((k) => k === "created")).toHaveLength(3);
    expect(logged.filter((k) => k === "milestoneId")).toHaveLength(3);
  });

  it("GivenAMilestoneWriteThatFails_WhenApprovedAgain_ThenEachMilestoneExistsOnce", async () => {
    let failOnce = true;
    const { tracker, project, plans, milestones } = await setupWithMilestones();
    const realCreate = milestones.create.bind(milestones);
    let creates = 0;
    milestones.create = async (...args) => {
      const made = await realCreate(...args);
      creates += 1;
      if (creates === 2 && failOnce) {
        failOnce = false;
        throw new Error("lost the reply");
      }
      return made;
    };
    await plans.propose(project.id, withCases, OWNER);
    await expect(plans.decide(project.id, { decision: "approved" }, OWNER)).rejects.toThrow(
      "lost the reply",
    );
    await plans.decide(project.id, { decision: "approved" }, OWNER);

    const listed = await milestones.list(project.id);
    expect(listed.map((m) => m.name)).toEqual([
      "M1: Walking skeleton",
      "M2: Log a run",
      "M3: Weekly summary",
    ]);
    expect((await tracker.listTickets(project.id)).map((t) => t.milestoneId)).toEqual(
      listed.map((m) => m.id),
    );
  });
});
