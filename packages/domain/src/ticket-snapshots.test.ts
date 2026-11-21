import { InMemoryWorkTracker, type Ticket } from "@andy/contracts";
import { countReads } from "@andy/contracts/testing";
import { describe, expect, it, vi } from "vitest";
import {
  SNAPSHOT_FULL_READ_MS,
  SNAPSHOT_MAX_PROJECTS,
  ProjectTickets,
  TicketSnapshots,
  matchesTicketFilter,
} from "./ticket-snapshots";
import { PROJECT_CACHE_MAX_AGE_MS } from "./project-versions";

async function setup(tickets: number) {
  const raw = new InMemoryWorkTracker();
  await raw.createProject({ name: "Andy Intelligence", key: "AI" });
  const made: Ticket[] = [];
  for (let i = 0; i < tickets; i++) {
    made.push(await raw.createTicket("ai", { title: `T${i}`, type: "chore" }, "andy"));
  }
  const counted = countReads(raw);
  let now = 0;
  const snapshots = new TicketSnapshots(counted.store, () => now);
  return { raw, counted, snapshots, made, tick: (ms: number) => (now += ms) };
}

describe("TicketSnapshots (AI-317)", () => {
  it("GivenAColdStart_WhenRead_ThenEveryTicketIsReadOnceAndSortedByRank", async () => {
    const s = await setup(20);
    const tickets = await s.snapshots.tickets("ai", 1);
    expect(tickets).toEqual(await s.raw.listTickets("ai"));
    expect(s.counted.reads()).toBe(20);
  });

  it("GivenTheSameVersion_WhenReadAgain_ThenNothingIsRead", async () => {
    const s = await setup(20);
    await s.snapshots.tickets("ai", 1);
    s.counted.reset();
    await s.snapshots.tickets("ai", 1);
    expect(s.counted.reads()).toBe(0);
  });

  it("GivenTenTicketsChanged_WhenReadAtTheNewVersion_ThenOnlyTheyAreReadWhateverTheProjectSize", async () => {
    const reads: number[] = [];
    for (const size of [20, 300]) {
      // Tickets made two minutes apart, then ten edited an hour after the last.
      const clock = { at: Date.parse("2026-11-01T00:00:00.000Z") };
      const raw = new InMemoryWorkTracker(() => new Date(clock.at));
      await raw.createProject({ name: "A", key: "AI" });
      for (let i = 0; i < size; i++) {
        clock.at += 2 * 60_000;
        await raw.createTicket("ai", { title: `T${i}` }, "andy");
      }
      const counted = countReads(raw);
      const snapshots = new TicketSnapshots(counted.store, () => 0);
      await snapshots.tickets("ai", 1);
      clock.at += 60 * 60_000;
      for (const t of (await raw.listTickets("ai")).slice(0, 10)) {
        await raw.updateTicket("ai", t.id, { fields: { title: `${t.title}!` } }, "andy");
      }
      counted.reset();
      const after = await snapshots.tickets("ai", 2);
      reads.push(counted.reads());
      expect(after).toEqual(await raw.listTickets("ai"));
    }
    // The ten changed tickets, plus the newest one seen before (inside the overlap window).
    expect(reads).toEqual([11, 11]);
  });

  it("GivenAWriteThatDidNotBumpTheVersion_WhenReadPastTheCacheMaxAge_ThenTheChangeShows", async () => {
    const s = await setup(5);
    await s.snapshots.tickets("ai", 1);
    const renamed = await s.raw.updateTicket(
      "ai",
      s.made[0]!.id,
      { fields: { title: "Edited outside the app" } },
      "andy",
    );
    s.tick(PROJECT_CACHE_MAX_AGE_MS - 1);
    expect((await s.snapshots.tickets("ai", 1)).find((t) => t.id === renamed.id)?.title).toBe("T0");
    s.tick(1);
    expect((await s.snapshots.tickets("ai", 1)).find((t) => t.id === renamed.id)).toEqual(renamed);
  });

  it("GivenASnapshotPastItsFullReadAge_WhenRead_ThenEveryTicketIsReadAgain", async () => {
    const s = await setup(20);
    await s.snapshots.tickets("ai", 1);
    s.tick(SNAPSHOT_FULL_READ_MS);
    s.counted.reset();
    await s.snapshots.tickets("ai", 2);
    expect(s.counted.reads()).toBe(20);
  });

  it("GivenMoreProjectsThanTheCap_WhenRead_ThenTheLeastRecentlyReadIsReadInFullAgain", async () => {
    const raw = new InMemoryWorkTracker();
    for (let i = 0; i <= SNAPSHOT_MAX_PROJECTS; i++) {
      await raw.createProject({ name: `P${i}`, key: `P${i}` });
    }
    await raw.createTicket("p0", { title: "Only" }, "andy");
    const counted = countReads(raw);
    const snapshots = new TicketSnapshots(counted.store);
    for (let i = 0; i <= SNAPSHOT_MAX_PROJECTS; i++) await snapshots.tickets(`p${i}`, 1);
    counted.reset();
    await snapshots.tickets("p1", 1);
    expect(counted.reads()).toBe(0);
    await snapshots.tickets("p0", 1);
    expect(counted.reads()).toBe(1);
  });

  it("GivenEachFilter_WhenMatched_ThenItAgreesWithListTickets", async () => {
    const s = await setup(6);
    await s.raw.updateTicket("ai", s.made[0]!.id, { fields: { archived: true } }, "andy");
    await s.raw.updateTicket("ai", s.made[1]!.id, { fields: { needsAttention: true } }, "andy");
    await s.raw.updateTicket(
      "ai",
      s.made[2]!.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );
    await s.raw.updateTicket("ai", s.made[3]!.id, { fields: { upNextRank: "0001" } }, "andy");
    const all = await s.raw.listTickets("ai");
    for (const filter of [
      {},
      { archived: true },
      { archived: false },
      { needsAttention: true },
      { stage: "done" as const },
      { stage: "backlog" as const, archived: false },
      { upNext: true as const },
    ]) {
      expect(all.filter((t) => matchesTicketFilter(t, filter))).toEqual(
        await s.raw.listTickets("ai", filter),
      );
    }
  });
});

describe("ProjectTickets (AI-318)", () => {
  it("GivenVersionsAndSnapshots_WhenListedTwiceAtOneVersion_ThenTheSecondListReadsOnlyTheVersion", async () => {
    const s = await setup(20);
    const versions = { get: vi.fn().mockResolvedValue(3) };
    const tickets = new ProjectTickets(s.counted.store, versions, s.snapshots);
    expect(await tickets.list("ai")).toEqual(await s.raw.listTickets("ai"));
    s.counted.reset();

    await tickets.list("ai");

    expect(s.counted.reads()).toBe(0);
    expect(versions.get).toHaveBeenCalledTimes(2);
  });

  it("GivenTheVersionReadFails_WhenListed_ThenEveryTicketIsReadAndTheFailureLogged", async () => {
    const s = await setup(20);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const versions = { get: vi.fn().mockRejectedValue(new Error("unavailable")) };
    const tickets = new ProjectTickets(s.counted.store, versions, s.snapshots);

    expect(await tickets.list("ai")).toHaveLength(20);

    expect(s.counted.reads()).toBe(20);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("project-tickets"));
    error.mockRestore();
  });

  it("GivenNoSnapshots_WhenListed_ThenEveryTicketIsRead", async () => {
    const s = await setup(20);
    const tickets = new ProjectTickets(s.counted.store);

    await tickets.list("ai");

    expect(s.counted.reads()).toBe(20);
  });
});
