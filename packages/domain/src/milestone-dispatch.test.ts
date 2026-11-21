import {
  InMemoryCodeHost,
  InMemoryMilestoneStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type MilestoneStatus,
  type NewTicket,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { RefineDispatcher } from "./refine-dispatch";
import { RunService } from "./runs";
import { WorkflowExecutor } from "./test-executor";

/**
 * AI-306: M4.36: refine and build dispatch start a ticket only when its milestone is approved or
 * it has none (ADR-0131). A held ticket stays where it is; a milestone that can't be read holds.
 */

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const AT = "2026-11-21T12:00:00.000Z";

const ready = (title: string, extra: Partial<NewTicket> = {}): NewTicket => ({
  type: "feature",
  title,
  body: "Andy can't see his tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
  size: "S",
  sizeReason: "one screen",
  touches: [`areas/${title}/**`],
  ...extra,
});

describe("milestone holds at dispatch (AI-306)", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let milestones: InMemoryMilestoneStore;
  let runs: RunService;
  let projectId: string;
  let ms: number;
  const now = () => new Date((ms += 1000));

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ms = Date.parse(AT);
    tracker = new InMemoryWorkTracker(now);
    runStore = new InMemoryRunStore(now);
    milestones = new InMemoryMilestoneStore();
    const host = new InMemoryCodeHost([REPO]);
    runs = new RunService(tracker, runStore, new WorkflowExecutor(host), now, null, null, host);
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, {
      autoRefine: false,
      autoBuild: true,
      buildEnabled: true,
    });
  });

  const builder = (store: Pick<InMemoryMilestoneStore, "get"> | null = milestones) =>
    new BuildDispatcher(tracker, runStore, runs, now, null, null, null, store);

  const milestone = (id: string, status: MilestoneStatus) =>
    milestones.create({
      id,
      projectId,
      name: `M${id}: Things`,
      outcome: "Things work.",
      order: Number(id),
      status,
      createdAt: AT,
      updatedAt: AT,
    });

  /**
   * An epic in `milestoneId`. Nothing writes a ticket's milestone until AI-304: M4.34, so the
   * test sets it on the fake's stored ticket, as that write will.
   */
  const epicIn = async (milestoneId: string | null, parentId: string | null = null) => {
    const epic = await tracker.createTicket(
      projectId,
      { title: "Epic", type: "epic", parentId },
      "andy",
    );
    const stored = (tracker as unknown as { tickets: Map<string, Ticket> }).tickets.get(epic.id)!;
    stored.milestoneId = milestoneId;
    return epic;
  };

  const inReady = async (title: string, parentId: string | null) => {
    const t = await tracker.createTicket(projectId, ready(title, { parentId }), "andy");
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };

  const builds = async (ticketId: string) =>
    (await runStore.listForTicket(projectId, ticketId)).length;
  const decision = async () => (await tracker.getProject(projectId))!.lastDispatch?.decision;

  describe("build", () => {
    it("GivenATicketInAParkedMilestone_WhenNext_ThenItStaysInReadyAndTheNextTicketStarts", async () => {
      await milestone("6", "parked");
      const held = await inReady("Held", (await epicIn("6")).id);
      const free = await inReady("Free", null);
      const run = await builder().next(projectId);
      expect(run?.ticketId).toBe(free.id);
      expect(await builds(held.id)).toBe(0);
      expect((await tracker.getTicket(projectId, held.id))!.stage).toBe("ready");
    });

    it("GivenOnlyHeldTickets_WhenNext_ThenNothingStartsAndTheDecisionSaysMilestoneHeld", async () => {
      await milestone("6", "not_reviewed");
      const held = await inReady("Held", (await epicIn("6")).id);
      expect(await builder().next(projectId)).toBeNull();
      expect(await builds(held.id)).toBe(0);
      expect(await decision()).toBe("milestone_held");
    });

    it("GivenATicketInAnApprovedMilestone_WhenNext_ThenItStarts", async () => {
      await milestone("5", "approved");
      const ticket = await inReady("Go", (await epicIn("5")).id);
      expect((await builder().next(projectId))?.ticketId).toBe(ticket.id);
    });

    it("GivenAStoryUnderAChildEpic_WhenTheTopLevelEpicsMilestoneIsParked_ThenItIsHeld", async () => {
      await milestone("6", "parked");
      const top = await epicIn("6");
      const child = await epicIn(null, top.id);
      const held = await inReady("Held", child.id);
      expect(await builder().next(projectId)).toBeNull();
      expect(await builds(held.id)).toBe(0);
    });

    it("GivenTicketsWithNoMilestone_WhenNext_ThenTheyStartAsBefore", async () => {
      const underEpic = await inReady("Under", (await epicIn(null)).id);
      expect((await builder(null).next(projectId))?.ticketId).toBe(underEpic.id);
    });

    it("GivenTheMilestoneCantBeRead_WhenNext_ThenItsTicketIsHeld", async () => {
      await milestone("5", "approved");
      const held = await inReady("Held", (await epicIn("5")).id);
      const failing = { get: () => Promise.reject(new Error("unavailable")) };
      expect(await builder(failing).next(projectId)).toBeNull();
      expect(await builder(null).next(projectId)).toBeNull();
      expect(await builds(held.id)).toBe(0);
    });

    it("GivenMilestoneReadsPerDispatch_WhenSeveralTicketsShareOne_ThenItIsReadOnce", async () => {
      await milestone("6", "parked");
      const epic = await epicIn("6");
      for (const title of ["A", "B", "C"]) await inReady(title, epic.id);
      const get = vi.spyOn(milestones, "get");
      const list = vi.spyOn(milestones, "list");
      await builder().next(projectId);
      expect(get).toHaveBeenCalledTimes(1);
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe("refine", () => {
    const upNext = async (parentId: string | null) => {
      const t = await tracker.createTicket(
        projectId,
        { title: "Idea", type: "feature", parentId },
        "andy",
      );
      return tracker.updateTicket(
        projectId,
        t.id,
        { fields: { upNextRank: "a", upNextAt: new Date(ms).toISOString() } },
        "andy",
      );
    };
    const refiner = () => new RefineDispatcher(tracker, runStore, runs, now, milestones);

    beforeEach(() => tracker.updateProject(projectId, { autoRefine: true }));

    it("GivenAnUpNextTicketInAParkedMilestone_WhenNext_ThenNoRefineStarts", async () => {
      await milestone("6", "parked");
      const held = await upNext((await epicIn("6")).id);
      expect(await refiner().next(projectId)).toBeNull();
      expect(await builds(held.id)).toBe(0);
    });

    it("GivenAnUpNextTicketInAnApprovedMilestone_WhenNext_ThenRefineStarts", async () => {
      await milestone("5", "approved");
      const ticket = await upNext((await epicIn("5")).id);
      expect((await refiner().next(projectId))?.ticketId).toBe(ticket.id);
    });

    it("GivenManyUpNextTicketsUnderAFewEpics_WhenNext_ThenEachEpicAndMilestoneIsReadOnce", async () => {
      await milestone("6", "parked");
      const epics = [await epicIn("6"), await epicIn("6")];
      for (let i = 0; i < 8; i++) await upNext(epics[i % 2]!.id);
      const getTicket = vi.spyOn(tracker, "getTicket");
      const get = vi.spyOn(milestones, "get");
      expect(await refiner().next(projectId)).toBeNull();
      // AI-315: reads grow with the epics, not the tickets; held tickets cost no question reads.
      expect(getTicket).toHaveBeenCalledTimes(2);
      expect(get).toHaveBeenCalledTimes(1);
    });

    it("GivenAnUpNextTicketWithNoMilestone_WhenNext_ThenRefineStartsAsBefore", async () => {
      const ticket = await upNext(null);
      expect((await refiner().next(projectId))?.ticketId).toBe(ticket.id);
    });
  });
});
