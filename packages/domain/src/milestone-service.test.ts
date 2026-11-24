import {
  InMemoryConfigChangeStore,
  InMemoryMilestoneStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MILESTONE_ENTITY, MilestoneService } from "./milestone-service";

/** AI-304: M4.34: the milestone service the API and MCP share (ADR-0131). */

const NOW = new Date("2026-11-21T12:00:00.000Z");
const OWNER = "user:uid-1" as const;
const AGENT = "agent:run-1" as const;

describe("MilestoneService", () => {
  let tracker: InMemoryWorkTracker;
  let changes: InMemoryConfigChangeStore;
  let service: MilestoneService;
  let store: InMemoryMilestoneStore;
  let ids: number;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    // A ticking clock: each ticket write gets its own updatedAt, so a stale version is visible.
    let tick = 0;
    tracker = new InMemoryWorkTracker(() => new Date(NOW.getTime() + 1000 * tick++));
    changes = new InMemoryConfigChangeStore();
    ids = 0;
    store = new InMemoryMilestoneStore();
    service = new MilestoneService(
      tracker,
      store,
      changes,
      () => NOW,
      () => `id${++ids}`,
    );
    await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await tracker.createProject({ name: "Ops", key: "OPS" });
  });

  const epic = (title = "Roadmap", parentId: string | null = null) =>
    tracker.createTicket("ai", { title, type: "epic", parentId }, "andy");
  const logged = async () =>
    (await changes.listForProject("ai")).filter((c) => c.entity === MILESTONE_ENTITY);

  describe("create and list", () => {
    it("GivenTheOwner_WhenCreatingTwo_ThenListedInOrderNotReviewedAndEachLogged", async () => {
      const m1 = await service.create("ai", { name: "M4", outcome: "Epics on a roadmap" }, OWNER);
      const m2 = await service.create("ai", { name: "M5", outcome: "Many projects" }, OWNER);
      expect([m1.order, m2.order]).toEqual([0, 1]);
      expect(m1.status).toBe("not_reviewed");
      expect((await service.list("ai")).map((m) => m.name)).toEqual(["M4", "M5"]);
      expect((await logged()).map((c) => Object.keys(c.diff))).toEqual([["created"], ["created"]]);
    });

    it("GivenANonOwner_WhenCreating_ThenForbiddenAndNothingStored", async () => {
      await expect(service.create("ai", { name: "M4", outcome: "x" }, AGENT)).rejects.toMatchObject(
        { code: "forbidden" },
      );
      expect(await service.list("ai")).toEqual([]);
      expect(await logged()).toEqual([]);
    });

    it("GivenAnUnknownProject_WhenListed_ThenNotFound", async () => {
      await expect(service.list("nope")).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("update", () => {
    it("GivenAMilestone_WhenItsStatusIsSet_ThenSavedAndLoggedWithWhoAndBeforeAfter", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const approved = await service.update("ai", m.id, { status: "approved" }, OWNER, "go");
      expect(approved.status).toBe("approved");
      const last = (await logged()).find((c) => "status" in c.diff)!;
      expect(last).toMatchObject({
        entityId: m.id,
        projectId: "ai",
        diff: { status: { from: "not_reviewed", to: "approved" } },
        reason: "go",
        status: "applied",
      });
      expect(last.actor).toBe("andy");
    });

    it("GivenNothingChanges_WhenUpdated_ThenNothingIsLogged", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      await service.update("ai", m.id, { name: "M4" }, OWNER);
      expect((await logged()).length).toBe(1);
    });

    it("GivenTwoConcurrentEdits_WhenBothSave_ThenOneConflictsAndNeitherIsLost", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const results = await Promise.allSettled([
        service.update("ai", m.id, { status: "approved" }, OWNER),
        service.update("ai", m.id, { name: "M4a" }, OWNER),
      ]);
      const failed = results.filter((r) => r.status === "rejected");
      expect(failed).toHaveLength(1);
      expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({ code: "conflict" });
      expect((await logged()).length).toBe(2);
    });

    it("GivenANonOwnerOrAnUnknownMilestone_WhenUpdated_ThenRefused", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      await expect(service.update("ai", m.id, { status: "parked" }, AGENT)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(service.update("ai", "nope", { status: "parked" }, OWNER)).rejects.toMatchObject(
        { code: "not_found" },
      );
      // Another project's milestone is not found here.
      await expect(service.update("ops", m.id, { status: "parked" }, OWNER)).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("attach an epic", () => {
    it("GivenATopLevelEpic_WhenAttached_ThenItsMilestoneIsSetAndLogged", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const e = await epic();
      const updated = await service.setEpicMilestone("ai", e.key, m.id, OWNER);
      expect(updated.milestoneId).toBe(m.id);
      expect((await tracker.getTicket("ai", e.id))?.milestoneId).toBe(m.id);
      expect((await logged())[0]).toMatchObject({
        entityId: e.id,
        diff: { milestoneId: { from: null, to: m.id } },
      });
    });

    it("GivenAFeatureOrAChildEpic_WhenAttached_ThenRefusedWithTheReason", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const parent = await epic();
      const child = await epic("Child", parent.id);
      const feature = await tracker.createTicket("ai", { title: "Chips", type: "feature" }, "andy");
      await expect(service.setEpicMilestone("ai", feature.key, m.id, OWNER)).rejects.toThrow(
        /only a top-level epic/,
      );
      await expect(service.setEpicMilestone("ai", child.key, m.id, OWNER)).rejects.toThrow(
        /child epic/,
      );
    });

    it("GivenAnotherProjectsMilestone_WhenAttached_ThenNotFoundAndNothingChanges", async () => {
      const theirs = await service.create("ops", { name: "Ops 1", outcome: "x" }, OWNER);
      const e = await epic();
      await expect(service.setEpicMilestone("ai", e.key, theirs.id, OWNER)).rejects.toMatchObject({
        code: "not_found",
      });
      expect((await tracker.getTicket("ai", e.id))?.milestoneId).toBeNull();
    });

    it("GivenAnAttachedEpic_WhenDetached_ThenNoMilestone", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const e = await epic();
      await service.setEpicMilestone("ai", e.key, m.id, OWNER);
      expect((await service.setEpicMilestone("ai", e.key, null, OWNER)).milestoneId).toBeNull();
    });

    it("GivenANonOwner_WhenAttaching_ThenForbidden", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const e = await epic();
      await expect(service.setEpicMilestone("ai", e.key, m.id, AGENT)).rejects.toMatchObject({
        code: "forbidden",
      });
    });
  });

  describe("revert", () => {
    it("GivenAStatusChange_WhenReverted_ThenThePreviousStatusIsBackAndTheChangeMarked", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      await service.update("ai", m.id, { status: "approved" }, OWNER);
      const change = (await logged()).find((c) => "status" in c.diff)!;
      const { reverted, milestone } = await service.revert(change, OWNER);
      expect(milestone?.status).toBe("not_reviewed");
      expect(reverted.status).toBe("reverted");
    });

    it("GivenAnAttach_WhenReverted_ThenTheEpicHasItsPreviousMilestone", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const e = await epic();
      await service.setEpicMilestone("ai", e.key, m.id, OWNER);
      const change = (await logged()).find((c) => "milestoneId" in c.diff)!;
      const { epic: restored } = await service.revert(change, OWNER);
      expect(restored?.milestoneId).toBeNull();
    });

    it("GivenALaterChange_WhenTheEarlierOneIsReverted_ThenRefused", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      await service.update("ai", m.id, { status: "approved" }, OWNER);
      await service.update("ai", m.id, { status: "parked" }, OWNER);
      const first = (await logged()).find(
        (c) => (c.diff as { status?: { to: string } }).status?.to === "approved",
      )!;
      await expect(service.revert(first, OWNER)).rejects.toMatchObject({ code: "not_revertible" });
    });

    it("GivenTwoConcurrentReverts_WhenBothRun_ThenOnlyOneAppliesAndOneChangeIsLogged", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      await service.update("ai", m.id, { status: "approved" }, OWNER);
      const change = (await logged()).find((c) => "status" in c.diff)!;
      const before = (await logged()).length;
      const results = await Promise.allSettled([
        service.revert(change, OWNER),
        service.revert(change, OWNER),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await logged()).length).toBe(before + 1);
      expect((await service.list("ai"))[0]!.status).toBe("not_reviewed");
    });

    it("GivenAnEditBetweenTheRevertsCheckAndItsWrite_WhenReverted_ThenConflictAndTheEditStays", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      await service.update("ai", m.id, { status: "approved" }, OWNER);
      const change = (await logged()).find((c) => "status" in c.diff)!;
      // A second actor parks it right after the revert's check reads the milestone.
      const read = store.get.bind(store);
      vi.spyOn(store, "get").mockImplementationOnce(async (p, id) => {
        const found = await read(p, id);
        await service.update("ai", m.id, { status: "parked" }, OWNER);
        return found;
      });
      await expect(service.revert(change, OWNER)).rejects.toMatchObject({ code: "conflict" });
      expect((await service.list("ai"))[0]!.status).toBe("parked");
      expect((await changes.get(change.id))?.status).toBe("applied");
    });

    it("GivenAnAttachBetweenTheRevertsCheckAndItsWrite_WhenReverted_ThenConflictAndTheAttachStays", async () => {
      const m1 = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const m2 = await service.create("ai", { name: "M5", outcome: "y" }, OWNER);
      const e = await epic();
      await service.setEpicMilestone("ai", e.key, m1.id, OWNER);
      const change = (await logged()).find((c) => "milestoneId" in c.diff)!;
      const read = tracker.getTicket.bind(tracker);
      vi.spyOn(tracker, "getTicket").mockImplementationOnce(async (p, id) => {
        const found = await read(p, id);
        await service.setEpicMilestone("ai", e.key, m2.id, OWNER);
        return found;
      });
      await expect(service.revert(change, OWNER)).rejects.toMatchObject({ code: "conflict" });
      expect((await read("ai", e.id))?.milestoneId).toBe(m2.id);
      expect((await changes.get(change.id))?.status).toBe("applied");
    });

    it("GivenADiffWithNoKnownField_WhenReverted_ThenRefusedAndNotMarked", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const created = (await logged())[0]!;
      for (const diff of [{}, { colour: { from: "red", to: "blue" } }]) {
        const odd = { ...created, id: `odd${Object.keys(diff).length}`, diff, entityId: m.id };
        await changes.append(odd);
        await expect(service.revert(odd, OWNER)).rejects.toMatchObject({ code: "not_revertible" });
        expect((await changes.get(odd.id))?.status).toBe("applied");
      }
    });

    it("GivenACreation_WhenReverted_ThenRefusedParkItInstead", async () => {
      await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const created = (await logged())[0]!;
      await expect(service.revert(created, OWNER)).rejects.toThrow(/created a milestone/);
    });

    it("GivenANonOwner_WhenReverting_ThenForbidden", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      await service.update("ai", m.id, { status: "approved" }, OWNER);
      const change = (await logged()).find((c) => "status" in c.diff)!;
      await expect(service.revert(change, AGENT)).rejects.toMatchObject({ code: "forbidden" });
    });
  });

  describe("case (ADR-0149, AI-365)", () => {
    const CASE = {
      serves: "Andy",
      expectedReturn: "Decides in a minute.",
      cheapestTest: "Ask him.",
    };

    it("GivenACase_WhenCreated_ThenStoredAndInTheCreationLog", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x", case: CASE }, OWNER);
      expect(m.case).toEqual(CASE);
      const [created] = await logged();
      expect((created!.diff.created as { to: { case: unknown } }).to.case).toEqual(CASE);
    });

    it("GivenNoCase_WhenCreated_ThenStoredWithout", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      expect(m).not.toHaveProperty("case");
    });

    it("GivenAMilestoneWithoutACase_WhenOneIsSet_ThenSavedAndLoggedFromNull", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      const saved = await service.update("ai", m.id, { case: CASE }, OWNER, "worth it");
      expect(saved.case).toEqual(CASE);
      const change = (await logged()).find((c) => "case" in c.diff)!;
      expect(change.diff).toEqual({ case: { from: null, to: CASE } });
      expect(change.reason).toBe("worth it");
    });

    it("GivenTheSameCase_WhenSetAgain_ThenNothingIsLogged", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x", case: CASE }, OWNER);
      const same = await service.update("ai", m.id, { case: { ...CASE } }, OWNER);
      expect(same.updatedAt).toBe(m.updatedAt);
      expect(await logged()).toHaveLength(1);
    });

    it("GivenACase_WhenRemovedWithNull_ThenStoredWithoutAndLogged", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x", case: CASE }, OWNER);
      const saved = await service.update("ai", m.id, { case: null }, OWNER);
      expect(saved).not.toHaveProperty("case");
      expect((await store.get("ai", m.id))?.case).toBeUndefined();
      expect((await logged()).find((c) => "case" in c.diff)!.diff).toEqual({
        case: { from: CASE, to: null },
      });
    });

    it("GivenACaseEdit_WhenReverted_ThenThePreviousCaseIsBack", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x", case: CASE }, OWNER);
      await service.update("ai", m.id, { case: { ...CASE, serves: "Runners" } }, OWNER);
      const change = (await logged()).find((c) => "case" in c.diff)!;
      const { milestone } = await service.revert(change, OWNER);
      expect(milestone!.case).toEqual(CASE);
    });

    it("GivenASetCase_WhenReverted_ThenTheMilestoneHasNoCaseAgain", async () => {
      const m = await service.create("ai", { name: "M4", outcome: "x" }, OWNER);
      await service.update("ai", m.id, { case: CASE }, OWNER);
      const change = (await logged()).find((c) => "case" in c.diff)!;
      const { milestone } = await service.revert(change, OWNER);
      expect(milestone).not.toHaveProperty("case");
    });
  });
});
