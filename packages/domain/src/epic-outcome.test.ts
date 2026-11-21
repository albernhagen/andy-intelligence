import { EPIC_OUTCOME_MAX, InMemoryWorkTracker, Ticket, TicketFields } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPlanService } from "./project-plan";
import { outcomeProblem } from "./ticket-edits";
import { TicketService } from "./tickets";

/** AI-186: M4.24: Epic outcome field (ADR-0108 decision 2). */

const OWNER = "user:uid-1" as const;

describe("epic outcome", () => {
  let tracker: InMemoryWorkTracker;
  let service: TicketService;
  let projectId: string;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    service = new TicketService(tracker);
    projectId = (await tracker.createProject({ name: "AI", key: "AI" })).id;
  });

  it("GivenAnEpic_WhenItsOutcomeIsEdited_ThenItIsStored", async () => {
    const epic = await service.create(projectId, { title: "Roadmap", type: "epic" }, OWNER);
    expect(epic.outcome).toBeNull();
    const saved = await service.update(
      projectId,
      epic.id,
      { outcome: "Andy sees every milestone at a glance." },
      OWNER,
    );
    expect(saved.outcome).toBe("Andy sees every milestone at a glance.");
    expect((await tracker.getTicket(projectId, epic.id))?.outcome).toBe(saved.outcome);
    const cleared = await service.update(projectId, epic.id, { outcome: null }, OWNER);
    expect(cleared.outcome).toBeNull();
  });

  it("GivenAFeature_WhenAnOutcomeIsSet_ThenItIsRefusedWithAReason", async () => {
    const feature = await service.create(projectId, { title: "Chips", type: "feature" }, OWNER);
    await expect(
      service.update(projectId, feature.id, { outcome: "Done" }, OWNER),
    ).rejects.toMatchObject({ code: "invalid_field", message: expect.stringMatching(/epic/) });
    await expect(
      service.create(projectId, { title: "Chips", type: "chore", outcome: "Done" }, OWNER),
    ).rejects.toMatchObject({ code: "invalid_field" });
  });

  it("GivenAnEpicWithAnOutcome_WhenItsTypeChanges_ThenTheChangeIsRefusedUntilTheOutcomeIsCleared", async () => {
    const epic = await service.create(
      projectId,
      { title: "Roadmap", type: "epic", outcome: "Shipped" },
      OWNER,
    );
    await expect(
      service.update(projectId, epic.id, { type: "feature" }, OWNER),
    ).rejects.toMatchObject({ code: "invalid_field" });
    const changed = await service.update(
      projectId,
      epic.id,
      { type: "feature", outcome: null },
      OWNER,
    );
    expect(changed).toMatchObject({ type: "feature", outcome: null });
  });

  it("GivenAnOutcomeOverTheLimit_WhenParsed_ThenTheSchemaRefusesIt", () => {
    const long = "x".repeat(EPIC_OUTCOME_MAX + 1);
    expect(TicketFields.safeParse({ outcome: long }).success).toBe(false);
    expect(TicketFields.safeParse({ outcome: "x".repeat(EPIC_OUTCOME_MAX) }).success).toBe(true);
  });

  it("GivenATicketStoredBeforeTheField_WhenRead_ThenItsOutcomeIsNull", async () => {
    const epic = await service.create(projectId, { title: "Old", type: "epic" }, OWNER);
    const stored: Record<string, unknown> = { ...epic };
    delete stored.outcome;
    expect(Ticket.parse(stored).outcome).toBeNull();
  });

  it("GivenNoTypeOrAnEpic_WhenOutcomeProblemIsAsked_ThenOnlyNonEpicsWithAnOutcomeFail", () => {
    expect(outcomeProblem({ type: "epic", outcome: "x" })).toBeNull();
    expect(outcomeProblem({ type: "bug", outcome: null })).toBeNull();
    expect(outcomeProblem({ type: null, outcome: "x" })).toMatch(/set the type to epic/);
  });

  it("GivenAProjectPlan_WhenApproved_ThenEachEpicCarriesItsGoalAndDoneWhenLines", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const plans = new ProjectPlanService(
      tracker,
      service,
      () => new Date("2026-11-21T00:00:00.000Z"),
    );
    await plans.propose(
      projectId,
      {
        summary: "Skeleton first.",
        milestones: [
          {
            title: "Walking skeleton",
            goal: "Andy can\n  open the app.",
            doneWhen: ["The URL loads", "CI is green"],
            slices: ["Repo and CI"],
          },
        ],
      },
      OWNER,
    );
    const { epics } = await plans.decide(projectId, { decision: "approved" }, OWNER);
    expect(epics[0]).toMatchObject({
      type: "epic",
      outcome: "Andy can open the app.",
      acceptanceCriteria: ["The URL loads", "CI is green"],
    });
  });
});
