import { InMemoryMergeQueueStore, emptyMergeQueue } from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import { MAX_HOLD_REPOS, MergeHoldReader } from "./merge-holds";

const entry = {
  projectId: "ai",
  number: 1,
  kind: "gate" as const,
  enqueuedAt: "2026-11-25T10:00:00.000Z",
  enqueuedBy: "system",
  headSha: "a".repeat(40),
  syncs: 0,
  syncRequestedSha: null,
  judgedSince: null,
};
const mainRed = {
  since: "2026-11-25T10:00:00.000Z",
  checks: ["ci"],
  raisedAt: null,
  sha: null,
};

describe("MergeHoldReader", () => {
  it("GivenOneRepoReadFails_WhenRead_ThenItIsLeftOutAndTheOthersAreListed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const store = new InMemoryMergeQueueStore();
    await store.put({ ...emptyMergeQueue("o/red"), entries: [entry], mainRed }, 0);
    const get = store.get.bind(store);
    store.get = async (repo) =>
      repo === "o/broken" ? Promise.reject(new Error("parse")) : get(repo);
    const holds = await new MergeHoldReader(store).forRepos(["o/broken", "o/red"]);
    expect(holds.map((h) => h.repo)).toEqual(["o/red"]);
  });

  it("GivenOneRepoHeldAndOneNot_WhenRead_ThenOnlyTheHeldOneIsListed", async () => {
    const store = new InMemoryMergeQueueStore();
    await store.put({ ...emptyMergeQueue("o/red"), entries: [entry], mainRed }, 0);
    await store.put({ ...emptyMergeQueue("o/green"), entries: [entry] }, 0);
    expect(await new MergeHoldReader(store).forRepos(["o/red", "o/green"])).toEqual([
      { repo: "o/red", since: mainRed.since, checks: ["ci"], waiting: 1, raised: false },
    ]);
  });

  it("GivenARedRecordWithNoPrWaiting_WhenRead_ThenItIsNotAHold", async () => {
    const store = new InMemoryMergeQueueStore();
    await store.put({ ...emptyMergeQueue("o/red"), mainRed }, 0);
    expect(await new MergeHoldReader(store).forRepos(["o/red"])).toEqual([]);
  });

  it("GivenMoreReposThanTheCap_WhenRead_ThenOnlyTheCapIsRead", async () => {
    const store = new InMemoryMergeQueueStore();
    let reads = 0;
    const get = store.get.bind(store);
    store.get = async (repo) => (reads++, get(repo));
    const repos = Array.from({ length: MAX_HOLD_REPOS + 5 }, (_, i) => `o/r${i}`);
    await new MergeHoldReader(store).forRepos(repos);
    expect(reads).toBe(MAX_HOLD_REPOS);
  });
});
