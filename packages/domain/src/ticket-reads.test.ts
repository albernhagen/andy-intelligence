import { InMemoryWorkTracker, type NewTicket } from "@andy/contracts";
import { countReads } from "@andy/contracts/testing";
import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { MAX_CHAIN_READS, blockerChain, parentChain, statusLineTickets } from "./ticket-reads";

async function project(fillers = 0) {
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await tracker.createProject({ name: "Ops", key: "OPS" });
  for (let i = 0; i < fillers; i++)
    await tracker.createTicket("ai", { title: `Filler ${i}` }, "andy");
  const make = (input: NewTicket, projectId = "ai") =>
    tracker.createTicket(projectId, input, "andy");
  const toReady = (id: string) =>
    tracker.updateTicket("ai", id, { stage: { to: "ready", forced: true, reason: null } }, "andy");
  return { tracker, make, toReady };
}

describe("statusLineTickets", () => {
  it("GivenAStoryWithABlocker_WhenRead_ThenTheStoryAndBlockerOnlyAtAnyProjectSize", async () => {
    const reads: number[] = [];
    for (const fillers of [5, 100]) {
      const { tracker, make } = await project(fillers);
      const blocker = await make({ title: "Blocker" });
      const story = await make({ title: "Story", blockedBy: [blocker.key] });
      const counted = countReads(tracker);
      const tickets = await statusLineTickets(counted.store, story);
      expect(tickets.map((t) => t.key).sort()).toEqual([blocker.key, story.key].sort());
      reads.push(counted.reads());
    }
    expect(reads).toEqual([1, 1]);
  });

  it("GivenABlockerInAnotherProject_WhenRead_ThenItIsLeftOutAsTheBoardDoes", async () => {
    const { tracker, make } = await project();
    const elsewhere = await make({ title: "Ops work" }, "ops");
    const story = await make({ title: "Story", blockedBy: [elsewhere.key] });
    const counted = countReads(tracker);
    expect((await statusLineTickets(counted.store, story)).map((t) => t.key)).toEqual([story.key]);
    expect(counted.reads()).toBe(0);
  });

  it("GivenAReadyTicket_WhenRead_ThenTheReadyLaneAndItsBlockersComeToo", async () => {
    const { tracker, make, toReady } = await project(20);
    const blocker = await make({ title: "Blocker" });
    const first = await make({ title: "First", blockedBy: [blocker.key] });
    const second = await make({ title: "Second" });
    await toReady(first.id);
    const ready = await toReady(second.id);
    const keys = (await statusLineTickets(tracker, ready)).map((t) => t.key).sort();
    expect(keys).toEqual([blocker.key, first.key, second.key].sort());
  });
});

describe("blockerChain", () => {
  it("GivenAChainAcrossProjects_WhenRead_ThenEveryTicketOnItByKeyAndId", async () => {
    const { tracker, make } = await project(50);
    const ops = await make({ title: "Ops end" }, "ops");
    const middle = await make({ title: "Middle", blockedBy: [ops.key] });
    const story = await make({ title: "Story" });
    const counted = countReads(tracker);
    const byRef = await blockerChain(counted.store, story, [middle.key]);
    expect(byRef.get(ops.key)?.id).toBe(ops.id);
    expect(byRef.get(middle.id)?.key).toBe(middle.key);
    expect(byRef.get(story.key)?.id).toBe(story.id);
    expect(counted.reads()).toBe(2);
  });

  it("GivenAnUnknownEntry_WhenRead_ThenItIsLeftOut", async () => {
    const { tracker, make } = await project();
    const story = await make({ title: "Story" });
    expect((await blockerChain(tracker, story, ["AI-999"])).has("AI-999")).toBe(false);
  });

  it("GivenAChainLongerThanTheCap_WhenRead_ThenRefused", async () => {
    const { tracker, make } = await project();
    let last = await make({ title: "End" });
    for (let i = 0; i < MAX_CHAIN_READS; i++)
      last = await make({ title: `Link ${i}`, blockedBy: [last.key] });
    const story = await make({ title: "Story" });
    await expect(blockerChain(tracker, story, [last.key])).rejects.toBeInstanceOf(DomainError);
  });
});

describe("parentChain", () => {
  it("GivenNestedEpics_WhenRead_ThenTheParentAndItsAncestorsNearestFirst", async () => {
    const { tracker, make } = await project(30);
    const top = await make({ title: "Top", type: "epic" });
    const mid = await make({ title: "Mid", type: "epic", parentId: top.id });
    const counted = countReads(tracker);
    expect((await parentChain(counted.store, "ai", mid.id)).map((t) => t.key)).toEqual([
      mid.key,
      top.key,
    ]);
    expect(counted.reads()).toBe(2);
  });
});
