import {
  InMemoryMilestoneStore,
  InMemoryWorkTracker,
  type BoardTicket,
  type Milestone,
} from "@andy/contracts";
import { describe, expect, it } from "vitest";
import {
  MAX_ROADMAP_CHILD_EPICS,
  MAX_ROADMAP_EPICS,
  MAX_ROADMAP_PROJECTS,
  RoadmapReader,
  buildRoadmap,
  roadmapState,
} from "./roadmap";

type Over = Partial<Omit<BoardTicket, "summary">> & { summary?: Partial<BoardTicket["summary"]> };

const card = (n: number, { summary, ...over }: Over = {}, projectId = "ai"): BoardTicket =>
  ({
    id: `${projectId}-t${n}`,
    projectId,
    key: `${projectId.toUpperCase()}-${n}`,
    title: `Ticket ${n}`,
    type: "feature",
    parentId: null,
    stage: "backlog",
    rank: String(n).padStart(10, "0"),
    archived: false,
    needsAttention: false,
    blockedBy: [],
    upNextRank: null,
    acceptanceCriteria: [],
    outcome: null,
    milestoneId: null,
    ...over,
    summary: { openQuestions: 0, run: null, pullRequest: null, worker: "agent", ...summary },
  }) as BoardTicket;

const epic = (n: number, over: Over = {}) => card(n, { type: "epic", ...over });
const under = (parent: number, n: number, over: Over = {}) =>
  card(n, { parentId: `ai-t${parent}`, ...over });

const PROJECT = { id: "ai", key: "AI", name: "Andy Intelligence" };

describe("roadmap (AI-193)", () => {
  it("GivenEpicsWithStories_WhenBuilt_ThenTopLevelEpicsInRankOrderWithOutcomeStateProgressAndCounts", () => {
    const tickets = [
      epic(2, { title: "M2", outcome: "Self-hosting works", acceptanceCriteria: ["A", "B"] }),
      epic(1, { title: "M1", stage: "done" }),
      under(1, 10, { stage: "done" }),
      under(2, 20, { stage: "done" }),
      under(2, 21, { stage: "ready_for_review" }),
      under(2, 22, { stage: "in_progress", summary: { openQuestions: 1 } }),
      under(2, 23, { blockedBy: ["AI-24"] }),
      under(2, 24, { stage: "ready" }),
      under(2, 25, { stage: "cancelled" }),
      card(30),
    ];

    const roadmap = buildRoadmap(PROJECT, tickets);

    expect(roadmap.epics.map((e) => [e.key, e.state])).toEqual([
      ["AI-1", "done"],
      ["AI-2", "in_progress"],
    ]);
    expect(roadmap.epics[1]).toMatchObject({
      title: "M2",
      outcome: "Self-hosting works",
      doneWhen: ["A", "B"],
      stage: "backlog",
      progress: { done: 1, total: 5 },
      counts: { needsYou: 1, inReview: 1, inProgress: 1, blocked: 1, notStarted: 1 },
      children: [],
    });
    expect(roadmap.truncated).toBe(false);
  });

  it("GivenAChildEpic_WhenBuilt_ThenNestedOnceAndItsStoriesCountInTheParent", () => {
    const tickets = [
      epic(1),
      epic(2, { parentId: "ai-t1" }),
      epic(3, { parentId: "ai-t2" }),
      under(1, 10, { stage: "done" }),
      under(2, 20, { stage: "in_progress" }),
      under(3, 30, { stage: "done" }),
    ];

    const roadmap = buildRoadmap(PROJECT, tickets);

    expect(roadmap.epics).toHaveLength(1);
    const top = roadmap.epics[0]!;
    expect(top.progress).toEqual({ done: 2, total: 3 });
    expect(top.children.map((c) => [c.key, c.progress, c.children])).toEqual([
      ["AI-2", { done: 1, total: 2 }, []],
    ]);
  });

  it("GivenArchivedOrCancelledEpics_WhenBuilt_ThenLeftOut", () => {
    const tickets = [epic(1, { archived: true }), epic(2, { stage: "cancelled" }), epic(3)];

    expect(buildRoadmap(PROJECT, tickets).epics.map((e) => e.key)).toEqual(["AI-3"]);
  });

  it.each([
    ["backlog", [], "not_started"],
    ["backlog", ["backlog", "cancelled"], "not_started"],
    ["backlog", ["backlog", "ready"], "in_progress"],
    ["in_progress", ["backlog", "done"], "in_progress"],
    ["done", ["backlog"], "done"],
  ] as const)(
    "GivenEpicStage%sAndStories%j_WhenStateRead_ThenItIs%s",
    (stage, tickets, expected) => {
      expect(roadmapState({ stage }, tickets)).toBe(expected);
    },
  );

  it("GivenAWorkerToPick_WhenBuilt_ThenTheStoryCountsAsNeedsYou", () => {
    const tickets = [
      epic(1),
      under(1, 10, { summary: { worker: "ask" } }),
      under(1, 11, { needsAttention: true }),
      under(1, 12, { stage: "done", needsAttention: true }),
    ];

    expect(buildRoadmap(PROJECT, tickets).epics[0]!.counts.needsYou).toBe(2);
  });

  it("GivenTooManyEpics_WhenBuilt_ThenCappedAndTruncated", () => {
    const top = Array.from({ length: MAX_ROADMAP_EPICS + 1 }, (_, i) => epic(i + 1));
    const subs = Array.from({ length: MAX_ROADMAP_CHILD_EPICS + 1 }, (_, i) =>
      epic(1000 + i, { parentId: "ai-t1" }),
    );

    const many = buildRoadmap(PROJECT, top);
    const nested = buildRoadmap(PROJECT, [epic(1), ...subs]);

    expect(many.epics).toHaveLength(MAX_ROADMAP_EPICS);
    expect(many.truncated).toBe(true);
    expect(nested.epics[0]!.children).toHaveLength(MAX_ROADMAP_CHILD_EPICS);
    expect(nested.truncated).toBe(true);
  });
});

describe("RoadmapReader (AI-193)", () => {
  async function reader(keys: string[]) {
    const tracker = new InMemoryWorkTracker();
    for (const key of keys) await tracker.createProject({ name: key, key });
    const read: string[] = [];
    const roadmaps = new RoadmapReader(tracker, {
      tickets: async (projectId) => {
        read.push(projectId);
        return [epic(1, { projectId, key: `${projectId.toUpperCase()}-1` })];
      },
    });
    return { roadmaps, read };
  }

  it("GivenOneProject_WhenRead_ThenItsBoardIsReadOnce", async () => {
    const { roadmaps, read } = await reader(["AI"]);

    const roadmap = await roadmaps.project("ai");

    expect(roadmap).toMatchObject({ projectKey: "AI", epics: [{ key: "AI-1" }] });
    expect(read).toEqual(["ai"]);
  });

  it("GivenAnUnknownProject_WhenRead_ThenNotFound", async () => {
    const { roadmaps } = await reader([]);

    await expect(roadmaps.project("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("GivenProjectsTheCallerMayNotRead_WhenAllRead_ThenLeftOutAndNotRead", async () => {
    const { roadmaps, read } = await reader(["OPS", "AI", "WEB"]);

    const roadmap = await roadmaps.all(async (id) => id !== "ops");

    expect(roadmap.projects.map((p) => p.projectKey)).toEqual(["AI", "WEB"]);
    expect(read.sort()).toEqual(["ai", "web"]);
    expect(roadmap.truncated).toBe(false);
  });

  it("GivenMoreProjectsThanTheCap_WhenAllRead_ThenTheFirstByKeyAndTruncated", async () => {
    const keys = Array.from({ length: MAX_ROADMAP_PROJECTS + 1 }, (_, i) => `P${100 + i}`);
    const { roadmaps, read } = await reader(keys);

    const roadmap = await roadmaps.all(async () => true);

    expect(roadmap.projects).toHaveLength(MAX_ROADMAP_PROJECTS);
    expect(roadmap.projects[0]!.projectKey).toBe("P100");
    expect(read).toHaveLength(MAX_ROADMAP_PROJECTS);
    expect(roadmap.truncated).toBe(true);
  });
});

describe("roadmap by milestone (AI-305)", () => {
  const ms = (id: string, order: number, status: Milestone["status"] = "approved"): Milestone => ({
    id,
    projectId: "ai",
    name: id.toUpperCase(),
    outcome: `${id} works`,
    order,
    status,
    createdAt: "2026-11-21T00:00:00.000Z",
    updatedAt: "2026-11-21T00:00:00.000Z",
  });

  it("GivenMilestonesWithEpics_WhenBuilt_ThenMilestonesInOrderWithSummedProgressAndEpicKeys", () => {
    const tickets = [
      epic(1, { milestoneId: "m2" }),
      epic(2, { milestoneId: "m1" }),
      epic(3, { milestoneId: "m1" }),
      epic(4),
      under(2, 20, { stage: "done" }),
      under(3, 30, { stage: "in_progress" }),
      under(1, 10, { stage: "ready_for_review" }),
    ];

    const roadmap = buildRoadmap(PROJECT, tickets, [ms("m2", 2, "parked"), ms("m1", 1)]);

    expect(roadmap.milestones.map((m) => [m.id, m.status, m.epicKeys])).toEqual([
      ["m1", "approved", ["AI-2", "AI-3"]],
      ["m2", "parked", ["AI-1"]],
    ]);
    expect(roadmap.milestones[0]).toMatchObject({
      name: "M1",
      outcome: "m1 works",
      done: false,
      progress: { done: 1, total: 2 },
      counts: { inProgress: 1 },
    });
    expect(roadmap.noMilestone).toEqual(["AI-4"]);
    expect(roadmap.epics.map((e) => e.key)).toEqual(["AI-1", "AI-2", "AI-3", "AI-4"]);
  });

  it.each([
    ["approved", ["done", "done"], true],
    ["approved", ["done", "in_progress"], false],
    ["parked", ["done"], false],
    ["not_reviewed", ["done"], false],
  ] as const)("GivenA%sMilestoneWithEpics%j_WhenBuilt_ThenDoneIs%s", (status, stages, expected) => {
    const tickets = stages.map((stage, i) => epic(i + 1, { stage, milestoneId: "m1" }));

    expect(buildRoadmap(PROJECT, tickets, [ms("m1", 1, status)]).milestones[0]!.done).toBe(
      expected,
    );
  });

  it("GivenAnApprovedMilestoneWithNoEpic_WhenBuilt_ThenItIsNotDone", () => {
    expect(buildRoadmap(PROJECT, [], [ms("m1", 1)]).milestones[0]!.done).toBe(false);
  });

  it("GivenAnEpicNamingAMissingMilestone_WhenBuilt_ThenItIsUnderNoMilestone", () => {
    const roadmap = buildRoadmap(PROJECT, [epic(1, { milestoneId: "gone" })], [ms("m1", 1)]);

    expect(roadmap.noMilestone).toEqual(["AI-1"]);
    expect(roadmap.milestones[0]!.epicKeys).toEqual([]);
  });

  it("GivenAMilestoneStore_WhenAProjectIsRead_ThenItsMilestonesAreReadOnce", async () => {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "AI", key: "AI" });
    const store = new InMemoryMilestoneStore();
    await store.create(ms("m1", 1));
    let lists = 0;
    const roadmaps = new RoadmapReader(
      tracker,
      { tickets: async () => [epic(1, { milestoneId: "m1" })] },
      { list: async (id) => (lists++, store.list(id)) },
    );

    const roadmap = await roadmaps.project("ai");

    expect(roadmap.milestones.map((m) => m.epicKeys)).toEqual([["AI-1"]]);
    expect(lists).toBe(1);
  });
});
