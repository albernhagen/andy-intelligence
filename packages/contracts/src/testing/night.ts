import { describe, expect, it } from "vitest";
import { NightLaunch } from "../entities/night";
import type { NightLaunchStore } from "../ports/night";

export interface NightLaunchStoreContractOptions {
  /** Per-test timeout for the concurrent cases: emulator transactions retry under contention. */
  raceTimeoutMs?: number;
}

/** `make` must return a store with nothing in it. */
export function nightLaunchStoreContract(
  name: string,
  make: () => Promise<NightLaunchStore>,
  options: NightLaunchStoreContractOptions = {},
): void {
  const itRaces = (title: string, fn: () => Promise<void>) => it(title, fn, options.raceTimeoutMs);

  describe(`NightLaunchStore contract: ${name}`, () => {
    const start = new Date("2026-11-12T22:00:00.000Z");
    const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000).toISOString();
    const launch = (overrides: Partial<NightLaunch> = {}): NightLaunch =>
      NightLaunch.parse({
        id: crypto.randomUUID(),
        projectId: "ai",
        epicId: "epic-1",
        epicKey: "AI-84",
        budget: { maxRuns: 20, maxTokens: 5_000_000, maxUsd: 50 },
        stopAt: at(8 * 60),
        status: "running",
        storyKeys: ["AI-85", "AI-86"],
        createdAt: at(0),
        createdBy: "andy",
        startedAt: at(0),
        ...overrides,
      });

    it("GivenAStoredLaunch_WhenReadById_ThenItComesBackUnchanged", async () => {
      const store = await make();
      const l = launch();
      expect(await store.create(l)).toEqual(l);
      expect(await store.get(l.id)).toEqual(l);
      expect(await store.get("missing")).toBeNull();
    });

    it("GivenARunningLaunch_WhenAnotherActiveOneIsCreatedInTheProject_ThenConflict", async () => {
      const store = await make();
      await store.create(launch());
      await expect(store.create(launch())).rejects.toMatchObject({
        name: "WorkTrackerError",
        code: "conflict",
      });
      await expect(store.create(launch({ status: "stopping" }))).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("GivenARunningLaunch_WhenOneStartsInAnotherProjectOrIsPlanned_ThenBothAreStored", async () => {
      const store = await make();
      await store.create(launch());
      await store.create(launch({ projectId: "other" }));
      await store.create(launch({ status: "planned", startedAt: null }));
      expect(await store.listForProject("ai")).toHaveLength(2);
    });

    it("GivenADuplicateId_WhenCreated_ThenConflict", async () => {
      const store = await make();
      const l = launch({ status: "ended", endedAt: at(1), endReason: "stopped" });
      await store.create(l);
      await expect(store.create(l)).rejects.toMatchObject({ code: "conflict" });
    });

    itRaces("GivenConcurrentStarts_WhenRacingInOneProject_ThenOnlyOneWins", async () => {
      const store = await make();
      const results = await Promise.allSettled([
        store.create(launch()),
        store.create(launch()),
        store.create(launch()),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await store.listForProject("ai")).toHaveLength(1);
    });

    it("GivenLaunches_WhenListed_ThenNewestFirstAndOnlyThatProject", async () => {
      const store = await make();
      const old = launch({ createdAt: at(0), status: "ended", endedAt: at(1), endReason: "done" });
      const recent = launch({ createdAt: at(5) });
      await store.create(old);
      await store.create(recent);
      await store.create(launch({ projectId: "other" }));
      expect((await store.listForProject("ai")).map((l) => l.id)).toEqual([recent.id, old.id]);
    });

    it("GivenLaunches_WhenFindingTheActiveOne_ThenOnlyARunningOrStoppingOneIsReturned", async () => {
      const store = await make();
      await store.create(launch({ status: "ended", endedAt: at(1), endReason: "done" }));
      await store.create(launch({ status: "planned", startedAt: null }));
      expect(await store.findActive("ai")).toBeNull();
      const running = launch();
      await store.create(running);
      expect(await store.findActive("ai")).toEqual(running);
      expect(await store.findActive("other")).toBeNull();
    });

    it("GivenARunningLaunch_WhenStoppedThenEnded_ThenEachStepIsStored", async () => {
      const store = await make();
      const l = launch();
      await store.create(l);

      expect(await store.transition(l.id, ["running"], { status: "stopping" })).toMatchObject({
        status: "stopping",
        endedAt: null,
      });
      const ended = await store.transition(l.id, ["running", "stopping"], {
        status: "ended",
        endedAt: at(30),
        endReason: "stopped",
      });
      expect(ended).toMatchObject({ status: "ended", endedAt: at(30), endReason: "stopped" });
      expect(await store.get(l.id)).toEqual(ended);
      expect(await store.findActive("ai")).toBeNull();
    });

    it("GivenALaunchInAnotherStatus_WhenTransitioned_ThenConflictAndNothingChanges", async () => {
      const store = await make();
      const l = launch({ status: "ended", endedAt: at(1), endReason: "done" });
      await store.create(l);
      await expect(
        store.transition(l.id, ["running"], { status: "stopping" }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(await store.get(l.id)).toEqual(l);
      await expect(
        store.transition("missing", ["running"], { status: "stopping" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("GivenARunningLaunch_WhenAPlannedOneIsStarted_ThenConflict", async () => {
      const store = await make();
      await store.create(launch());
      const planned = launch({ status: "planned", startedAt: null });
      await store.create(planned);
      await expect(
        store.transition(planned.id, ["planned"], { status: "running", startedAt: at(2) }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect((await store.get(planned.id))?.status).toBe("planned");
    });

    it("GivenAnInconsistentLaunch_WhenCreatedOrTransitionedTo_ThenRefusedAndNothingStored", async () => {
      const store = await make();
      const base = launch();
      expect(() => launch({ status: "ended" })).toThrow("an ended launch needs endedAt");
      expect(() => launch({ endReason: "done" })).toThrow("a running launch has no endReason");
      expect(() => launch({ startedAt: null })).toThrow("a running launch needs startedAt");
      expect(() => launch({ status: "planned" })).toThrow("a planned launch has no startedAt");
      await expect(store.create({ ...base, status: "ended" })).rejects.toThrow();
      expect(await store.get(base.id)).toBeNull();

      await store.create(base);
      await expect(store.transition(base.id, ["running"], { status: "ended" })).rejects.toThrow(
        "an ended launch needs endReason",
      );
      await expect(
        store.transition(base.id, ["running"], { status: "stopping", endReason: "done" }),
      ).rejects.toThrow("a stopping launch has no endReason");
      expect(await store.get(base.id)).toEqual(base);
    });

    itRaces("GivenConcurrentStops_WhenRacing_ThenOnlyOneTransitionWins", async () => {
      const store = await make();
      const l = launch();
      await store.create(l);
      const results = await Promise.allSettled([
        store.transition(l.id, ["running"], { status: "stopping" }),
        store.transition(l.id, ["running"], { status: "stopping" }),
        store.transition(l.id, ["running"], { status: "stopping" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
  });
}
