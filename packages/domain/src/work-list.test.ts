import { InMemoryWorkTracker, type BoardTicket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { MAX_WORK_PROJECTS, MAX_WORK_TICKETS, WorkReader } from "./work-list";

type Over = Partial<Omit<BoardTicket, "summary">> & { summary?: Partial<BoardTicket["summary"]> };

const card = (projectId: string, n: number, { summary, ...over }: Over = {}): BoardTicket =>
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
    ...over,
    summary: { openQuestions: 0, run: null, pullRequest: null, worker: "agent", ...summary },
  }) as BoardTicket;

async function reader(boards: Record<string, BoardTicket[]>) {
  const tracker = new InMemoryWorkTracker();
  for (const key of Object.keys(boards)) await tracker.createProject({ name: key, key });
  const read: string[] = [];
  const work = new WorkReader(tracker, {
    tickets: async (projectId) => {
      read.push(projectId);
      return boards[projectId.toUpperCase()] ?? [];
    },
  });
  return { work, read };
}

describe("WorkReader", () => {
  it("GivenTwoProjects_WhenListed_ThenTicketsInTheViewAreGroupedByProjectKey", async () => {
    const { work } = await reader({
      OPS: [card("ops", 1, { needsAttention: true })],
      AI: [card("ai", 1, { summary: { openQuestions: 1 } }), card("ai", 2)],
    });

    const list = await work.list("needs-me");

    expect(list.projects.map((p) => [p.key, p.count, p.tickets.map((t) => t.key)])).toEqual([
      ["AI", 1, ["AI-1"]],
      ["OPS", 1, ["OPS-1"]],
    ]);
    expect(list.counts).toEqual({
      "needs-me": 2,
      mine: 0,
      agents: 3,
      blocked: 0,
      "in-review": 0,
    });
    expect(list.truncated).toBe(false);
  });

  it("GivenOneProjectsTickets_WhenListed_ThenTheyGoByStageThenRank", async () => {
    const { work } = await reader({
      AI: [
        card("ai", 1, { stage: "ready", rank: "0000000002" }),
        card("ai", 2, { stage: "backlog" }),
        card("ai", 3, { stage: "ready", rank: "0000000001" }),
      ],
    });

    const list = await work.list("agents");

    expect(list.projects[0]!.tickets.map((t) => t.key)).toEqual(["AI-2", "AI-3", "AI-1"]);
  });

  it("GivenABlockedTicket_WhenListed_ThenItCarriesItsOpenBlockerKeys", async () => {
    const { work } = await reader({
      AI: [card("ai", 1), card("ai", 2, { blockedBy: ["AI-1"] })],
    });

    const list = await work.list("blocked");

    expect(list.projects[0]!.tickets).toMatchObject([{ key: "AI-2", blockers: ["AI-1"] }]);
  });

  it("GivenAProjectFilter_WhenListed_ThenOnlyThatProjectIsRead", async () => {
    const { work, read } = await reader({ AI: [card("ai", 1)], OPS: [card("ops", 1)] });

    const list = await work.list("agents", "ops");

    expect(read).toEqual(["ops"]);
    expect(list.projects.map((p) => p.key)).toEqual(["OPS"]);
  });

  it("GivenAnUnknownProject_WhenListed_ThenItIsNotFound", async () => {
    const { work } = await reader({ AI: [] });
    await expect(work.list("mine", "nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("GivenMoreMatchesThanTheCap_WhenListed_ThenTheFirstByProjectAndRankAreKeptAndItIsTruncated", async () => {
    const many = (projectId: string, n: number) =>
      Array.from({ length: n }, (_, i) => card(projectId, i + 1));
    const { work } = await reader({ AI: many("ai", 150), OPS: many("ops", 100) });

    const list = await work.list("agents");

    expect(list.truncated).toBe(true);
    expect(list.projects.map((p) => [p.key, p.count, p.tickets.length])).toEqual([
      ["AI", 150, 150],
      ["OPS", 100, MAX_WORK_TICKETS - 150],
    ]);
  });

  it("GivenMoreProjectsThanTheCap_WhenListed_ThenOnlyTheFirstByKeyAreReadAndItIsTruncated", async () => {
    const boards = Object.fromEntries(
      Array.from({ length: MAX_WORK_PROJECTS + 1 }, (_, i) => [
        `P${String(i).padStart(2, "0")}`,
        [],
      ]),
    );
    const { work, read } = await reader(boards);

    const list = await work.list("mine");

    expect(read).toHaveLength(MAX_WORK_PROJECTS);
    expect(read).not.toContain(`p${MAX_WORK_PROJECTS}`);
    expect(list.truncated).toBe(true);
  });
});
