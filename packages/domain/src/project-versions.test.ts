import {
  InMemoryProjectVersions,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type ProjectVersions,
} from "@andy/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_CACHE_MAX_AGE_MS,
  PROJECT_CACHE_MAX_ENTRIES,
  ProjectReadCache,
  bumpOnWrite,
} from "./project-versions";

const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;

async function setup() {
  const raw = new InMemoryWorkTracker();
  await raw.createProject({ name: "Andy Intelligence", key: "AI" });
  const versions = new InMemoryProjectVersions();
  const { tracker, runs } = bumpOnWrite(raw, new InMemoryRunStore(), versions);
  return { tracker, runs, versions };
}

describe("bumpOnWrite", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GivenEachKindOfWrite_WhenItLands_ThenTheProjectsVersionGoesUpByOne", async () => {
    const { tracker, runs, versions } = await setup();
    const t = await tracker.createTicket("ai", { title: "One" }, "andy");
    await tracker.updateTicket("ai", t.id, { fields: { title: "Two" } }, "andy");
    await tracker.addComment("ai", t.id, "hi", "andy");
    const q = await tracker.askQuestion("ai", t.id, { text: "Why?" }, "agent");
    await tracker.answerQuestion(q.id, "Because.", "ui", "andy");
    const run = await runs.create({
      projectId: "ai",
      ticketId: t.id,
      step: "refine",
      route,
      tier: null,
    });
    await runs.update(run.id, { status: "running" }, ["queued"]);
    expect(await versions.get("ai")).toBe(7);
  });

  it("GivenOnlyReads_WhenCalled_ThenTheVersionStays", async () => {
    const { tracker, runs, versions } = await setup();
    await tracker.listTickets("ai");
    await tracker.getProject("ai");
    await runs.listActive("ai");
    expect(await versions.get("ai")).toBe(0);
  });

  it("GivenABumpThatFails_WhenAWriteLands_ThenTheWriteStandsAndTheFailureIsLogged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: ProjectVersions = {
      get: async () => 0,
      bump: () => Promise.reject(new Error("quota")),
    };
    const raw = new InMemoryWorkTracker();
    await raw.createProject({ name: "Andy Intelligence", key: "AI" });
    const { tracker } = bumpOnWrite(raw, new InMemoryRunStore(), failing);
    const t = await tracker.createTicket("ai", { title: "Kept" }, "andy");
    expect(await raw.getTicket("ai", t.id)).not.toBeNull();
    expect(error.mock.calls[0]![0]).toContain("project version bump failed");
  });
});

describe("ProjectReadCache", () => {
  const counting = () => {
    let loads = 0;
    return { load: async () => ++loads, loads: () => loads };
  };

  it("GivenAnUnchangedVersion_WhenReadAgain_ThenServedWithoutLoading", async () => {
    const cache = new ProjectReadCache(new InMemoryProjectVersions());
    const c = counting();
    await cache.get("ai", "board", c.load);
    expect(await cache.get("ai", "board", c.load)).toBe(1);
    expect(c.loads()).toBe(1);
  });

  it("GivenABump_WhenReadAgain_ThenLoadedAgain", async () => {
    const versions = new InMemoryProjectVersions();
    const cache = new ProjectReadCache(versions);
    const c = counting();
    await cache.get("ai", "board", c.load);
    await versions.bump("ai");
    expect(await cache.get("ai", "board", c.load)).toBe(2);
  });

  it("GivenAnEntryPastItsMaxAge_WhenReadAgain_ThenLoadedAgain", async () => {
    let now = 0;
    const cache = new ProjectReadCache(new InMemoryProjectVersions(), () => now);
    const c = counting();
    await cache.get("ai", "board", c.load);
    now = PROJECT_CACHE_MAX_AGE_MS;
    expect(await cache.get("ai", "board", c.load)).toBe(2);
  });

  it("GivenTheVersionReadFails_WhenRead_ThenLoadedUncachedAndLogged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: ProjectVersions = {
      get: () => Promise.reject(new Error("unavailable")),
      bump: async () => {},
    };
    const cache = new ProjectReadCache(failing);
    const c = counting();
    await cache.get("ai", "board", c.load);
    expect(await cache.get("ai", "board", c.load)).toBe(2);
    expect(error.mock.calls[0]![0]).toContain("project version read failed");
    vi.restoreAllMocks();
  });

  it("GivenTwoViewsOrProjects_WhenRead_ThenEachIsCachedApart", async () => {
    const cache = new ProjectReadCache(new InMemoryProjectVersions());
    expect(await cache.get("ai", "board", async () => "ai board")).toBe("ai board");
    expect(await cache.get("ai", "tickets", async () => "ai tickets")).toBe("ai tickets");
    expect(await cache.get("ops", "board", async () => "ops board")).toBe("ops board");
  });

  it("GivenMoreViewsThanTheCap_WhenRead_ThenTheOldestIsDropped", async () => {
    const cache = new ProjectReadCache(new InMemoryProjectVersions());
    for (let i = 0; i <= PROJECT_CACHE_MAX_ENTRIES; i++)
      await cache.get(`p${i}`, "board", async () => i);
    const c = counting();
    await cache.get("p0", "board", c.load);
    expect(c.loads()).toBe(1);
  });
});
