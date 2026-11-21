import { InMemoryWorkTracker, type Ticket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import {
  MAX_MAP_EPICS,
  MAX_MAP_PR_READS,
  MAX_MAP_UNASSIGNED,
  MilestoneMapReader,
  buildMilestoneMap,
} from "./milestone-map";

const ticket = (n: number, over: Partial<Ticket> = {}): Ticket =>
  ({
    id: `t${n}`,
    projectId: "ai",
    key: `AI-${n}`,
    title: `Ticket ${n}`,
    type: "feature",
    parentId: "t0",
    stage: "backlog",
    rank: String(n).padStart(10, "0"),
    size: "M",
    archived: false,
    blockedBy: [],
    needsAttention: false,
    upNextRank: null,
    ...over,
  }) as Ticket;

const epic = ticket(0, { type: "epic", parentId: null, title: "M4: Epics" });
const project = { key: "AI" };
const noPrs = new Map<string, number>();

describe("milestone map (AI-148)", () => {
  it("GivenChildrenInEveryStage_WhenMapped_ThenEachLandsInItsGroup", () => {
    const tickets = [
      epic,
      ticket(1, { stage: "done" }),
      ticket(2, { stage: "ready_for_review" }),
      ticket(3, { stage: "in_progress", needsAttention: true }),
      ticket(4, { stage: "ready", blockedBy: ["AI-3"] }),
      ticket(5),
      ticket(6, { stage: "cancelled" }),
      ticket(7, { stage: "done", archived: true }),
    ];

    const map = buildMilestoneMap(project, tickets, new Map([["t2", 190]]));

    const e = map.epics[0]!;
    expect(e).toMatchObject({ key: "AI-0", progress: { done: 1, total: 5 }, cancelled: 1 });
    expect(e.done).toEqual(["AI-1"]);
    expect(e.inReview).toEqual([
      { key: "AI-2", title: "Ticket 2", prNumber: 190, openBlockers: [], needsAttention: false },
    ]);
    expect(e.inProgress.map((i) => [i.key, i.needsAttention])).toEqual([["AI-3", true]]);
    expect(e.blocked.map((i) => [i.key, i.openBlockers])).toEqual([["AI-4", ["AI-3"]]]);
    expect(e.notStarted.map((i) => i.key)).toEqual(["AI-5"]);
  });

  it("GivenAMap_WhenRendered_ThenTheTextListsEachGroupWithPrBlockerAndNeedsAndy", () => {
    const tickets = [
      epic,
      ticket(1, { stage: "done" }),
      ticket(2, { stage: "ready_for_review", needsAttention: true }),
      ticket(3, { blockedBy: ["AI-2"] }),
    ];

    const { text } = buildMilestoneMap(project, tickets, new Map([["t2", 7]]));

    expect(text).toBe(
      [
        "AI milestone map (from tickets)",
        "",
        "AI-0: M4: Epics: 1 of 3 done",
        "  Done: AI-1",
        "  In review: AI-2 (PR #7; needs Andy)",
        "  Blocked: AI-3 (on AI-2)",
      ].join("\n"),
    );
  });

  it("GivenDoneArchivedAndOpenEpics_WhenMapped_ThenOnlyOpenOnesInRankOrder", () => {
    const tickets = [
      ticket(10, { type: "epic", parentId: null, rank: "2" }),
      ticket(11, { type: "epic", parentId: null, rank: "1" }),
      ticket(12, { type: "epic", parentId: null, stage: "done" }),
      ticket(13, { type: "epic", parentId: null, archived: true }),
    ];

    const map = buildMilestoneMap(project, tickets, noPrs);

    expect(map.epics.map((e) => e.key)).toEqual(["AI-11", "AI-10"]);
  });

  it("GivenAnEpicKey_WhenMapped_ThenOnlyThatEpicEvenIfDoneAndNoUnassignedList", () => {
    const done = ticket(12, { type: "epic", parentId: null, stage: "done" });
    const tickets = [epic, done, ticket(1, { parentId: null })];

    const map = buildMilestoneMap(project, tickets, noPrs, { epicKey: "AI-12" });

    expect(map.epics.map((e) => e.key)).toEqual(["AI-12"]);
    expect(map.unassigned).toEqual([]);
  });

  it("GivenAKeyThatIsNoEpic_WhenMapped_ThenRefused", () => {
    const run = () => buildMilestoneMap(project, [epic, ticket(1)], noPrs, { epicKey: "AI-1" });
    expect(run).toThrow(DomainError);
  });

  it("GivenOpenTicketsUnderNoEpic_WhenMapped_ThenTheyAreListedAndDoneOnesAreNot", () => {
    const tickets = [
      epic,
      ticket(1, { parentId: null }),
      ticket(2, { parentId: null, stage: "done" }),
      ticket(3, { parentId: "t1" }),
    ];

    const map = buildMilestoneMap(project, tickets, noPrs);

    expect(map.unassigned).toEqual(["AI-1", "AI-3"]);
    expect(map.text).toContain("Under no epic: AI-1, AI-3");
  });

  it("GivenMoreThanTheCaps_WhenMapped_ThenEpicsAndUnassignedAreCutAndMarkedPartial", () => {
    const epics = Array.from({ length: MAX_MAP_EPICS + 1 }, (_, i) =>
      ticket(100 + i, { type: "epic", parentId: null }),
    );
    const loose = Array.from({ length: MAX_MAP_UNASSIGNED + 1 }, (_, i) =>
      ticket(500 + i, { parentId: null }),
    );

    const map = buildMilestoneMap(project, [...epics, ...loose], noPrs);

    expect(map.epics).toHaveLength(MAX_MAP_EPICS);
    expect(map.unassigned).toHaveLength(MAX_MAP_UNASSIGNED);
    expect(map.truncated).toEqual({ epics: true, prNumbers: false, unassigned: true });
    expect(map.text).toContain("Partial:");
  });

  it("GivenNoOpenEpics_WhenMapped_ThenTheTextSaysSo", () => {
    expect(buildMilestoneMap(project, [], noPrs).text).toContain("No open epics.");
  });
});

describe("milestone map reader (AI-148)", () => {
  async function seed() {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "AI", key: "AI" });
    const e = await tracker.createTicket("ai", { title: "M5", type: "epic" }, "andy");
    const child = async (title: string) => {
      const t = await tracker.createTicket("ai", { title, parentId: e.id }, "andy");
      await tracker.updateTicket(
        "ai",
        t.id,
        { stage: { to: "ready_for_review", forced: true, reason: null } },
        "andy",
      );
      return t;
    };
    return { tracker, e, child };
  }

  it("GivenATicketInReviewWithLinkedPrs_WhenRead_ThenTheLastPrNumberIsShown", async () => {
    const { tracker, child } = await seed();
    const t = await child("In review");
    const link = (number: number) => ({
      number,
      url: `https://github.com/o/r/pull/${number}`,
      state: "open" as const,
    });
    await tracker.linkPullRequest("ai", t.id, link(5), "system");
    await tracker.linkPullRequest("ai", t.id, link(9), "system");

    const map = await new MilestoneMapReader(tracker).map("ai");

    expect(map.epics[0]!.inReview[0]).toMatchObject({ key: t.key, prNumber: 9 });
  });

  it("GivenMoreTicketsInReviewThanTheCap_WhenRead_ThenHistoriesAreCappedAndMarkedPartial", async () => {
    const { tracker, child } = await seed();
    for (let i = 0; i <= MAX_MAP_PR_READS; i++) await child(`R${i}`);
    let reads = 0;
    const counting = {
      getProject: (id: string) => tracker.getProject(id),
      listTickets: (id: string) => tracker.listTickets(id),
      listEvents: (p: string, t: string) => {
        reads++;
        return tracker.listEvents(p, t);
      },
    };

    const map = await new MilestoneMapReader(counting).map("ai");

    expect(reads).toBe(MAX_MAP_PR_READS);
    expect(map.truncated.prNumbers).toBe(true);
    expect(map.epics[0]!.inReview).toHaveLength(MAX_MAP_PR_READS + 1);
  });

  it("GivenAnUnknownProject_WhenRead_ThenNotFound", async () => {
    const { tracker } = await seed();
    await expect(new MilestoneMapReader(tracker).map("nope")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
