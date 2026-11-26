import { describe, expect, it } from "vitest";
import {
  DEPLOYMENT_LIMITS,
  type Deployment,
  type DeploymentEnvironment,
  type NewDeployment,
} from "../entities/deployment";
import type { StoredRelease } from "../entities/release-entry";
import type { DeploymentStore } from "../ports/deployments";

/** `make` must return a store with nothing in it. */
export function deploymentStoreContract(
  name: string,
  make: () => Promise<DeploymentStore>,
  options: { timeoutMs?: number } = {},
): void {
  const test = (title: string, fn: () => Promise<void>) => it(title, fn, options.timeoutMs);

  describe(`DeploymentStore contract: ${name}`, () => {
    const start = Date.parse("2026-11-20T10:00:00.000Z");
    const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
    const hex = (n: number, len: number) => n.toString(16).padStart(len, "0");
    const deployment = (overrides: Partial<NewDeployment> = {}): NewDeployment => ({
      projectId: "ai",
      environment: "prod",
      imageDigest: `sha256:${hex(1, 64)}`,
      gitSha: hex(2, 40),
      revision: null,
      kind: "deploy",
      status: "started",
      startedAt: at(0),
      finishedAt: null,
      actor: "system",
      previousDeploymentId: null,
      ...overrides,
    });
    const startedAts = (list: Deployment[]) => list.map((d) => d.startedAt);

    test("GivenARecordedDeployment_WhenReadById_ThenItComesBackWithItsAssignedId", async () => {
      const store = await make();
      const recorded = await store.record(deployment({ revision: "control-plane-00042-abc" }));
      expect(recorded.id).toMatch(/^[A-Za-z0-9-]{1,80}$/);
      expect(recorded).toMatchObject({ projectId: "ai", status: "started", finishedAt: null });
      expect(await store.get(recorded.id)).toEqual(recorded);
      expect(await store.get("missing")).toBeNull();
    });

    test("GivenAStartedDeployment_WhenFinished_ThenItsStatusTimeAndRevisionAreStored", async () => {
      const store = await make();
      const recorded = await store.record(deployment());
      const done = await store.finish(recorded.id, {
        status: "succeeded",
        finishedAt: at(3),
        revision: "control-plane-00043-def",
      });
      expect(done).toEqual({
        ...recorded,
        status: "succeeded",
        finishedAt: at(3),
        revision: "control-plane-00043-def",
      });
      expect(await store.get(recorded.id)).toEqual(done);
    });

    test("GivenAKnownRevision_WhenFinishedWithoutOne_ThenTheRevisionIsKept", async () => {
      const store = await make();
      const recorded = await store.record(deployment({ revision: "control-plane-00042-abc" }));
      const done = await store.finish(recorded.id, {
        status: "succeeded",
        finishedAt: at(2),
        revision: undefined,
      });
      expect(done.revision).toBe("control-plane-00042-abc");
      expect((await store.get(recorded.id))?.revision).toBe("control-plane-00042-abc");
    });

    test("GivenAFinishedDeployment_WhenFinishedAgain_ThenConflictAndNothingChanges", async () => {
      const store = await make();
      const recorded = await store.record(deployment());
      const done = await store.finish(recorded.id, { status: "failed", finishedAt: at(1) });
      await expect(
        store.finish(recorded.id, { status: "succeeded", finishedAt: at(2) }),
      ).rejects.toMatchObject({ name: "WorkTrackerError", code: "conflict" });
      expect(await store.get(recorded.id)).toEqual(done);
    });

    test("GivenAnUnknownDeployment_WhenFinished_ThenNotFound", async () => {
      const store = await make();
      await expect(
        store.finish("missing", { status: "succeeded", finishedAt: at(1) }),
      ).rejects.toMatchObject({ name: "WorkTrackerError", code: "not_found" });
    });

    test("GivenAFinishTimeBeforeTheStart_WhenFinished_ThenItIsRefused", async () => {
      const store = await make();
      const recorded = await store.record(deployment({ startedAt: at(10) }));
      await expect(
        store.finish(recorded.id, { status: "succeeded", finishedAt: at(5) }),
      ).rejects.toThrow();
      expect((await store.get(recorded.id))?.status).toBe("started");
    });

    test("GivenDeploymentsInSeveralProjectsAndEnvironments_WhenListed_ThenOnlyThoseNewestFirst", async () => {
      const store = await make();
      for (const minutes of [5, 1, 9, 3])
        await store.record(deployment({ startedAt: at(minutes) }));
      await store.record(deployment({ environment: "dev", startedAt: at(20) }));
      await store.record(deployment({ projectId: "other", startedAt: at(30) }));
      expect(startedAts(await store.list("ai", "prod"))).toEqual([at(9), at(5), at(3), at(1)]);
      expect(startedAts(await store.list("ai", "dev"))).toEqual([at(20)]);
      expect(await store.list("ai", "preview")).toEqual([]);
    });

    test("GivenMoreDeploymentsThanThePage_WhenListed_ThenTheNewestPageOnly", async () => {
      const store = await make();
      for (let m = 0; m < 5; m += 1) await store.record(deployment({ startedAt: at(m) }));
      expect(startedAts(await store.list("ai", "prod", 2))).toEqual([at(4), at(3)]);
      expect(await store.list("ai", "prod", 0)).toHaveLength(1);
      expect(await store.list("ai", "prod")).toHaveLength(5);
    });

    test("GivenMoreThanTheCap_WhenAListOfAnySizeIsAsked_ThenAtMostTheCap", async () => {
      const store = await make();
      const cap = DEPLOYMENT_LIMITS.maxPage;
      for (let m = 0; m <= cap; m += 1) await store.record(deployment({ startedAt: at(m) }));
      const page = await store.list("ai", "prod", 1_000);
      expect(page).toHaveLength(cap);
      expect(page[0]!.startedAt).toBe(at(cap));
      expect(await store.list("ai", "prod")).toHaveLength(DEPLOYMENT_LIMITS.defaultPage);
    });

    const stored = (
      computedAt: string,
      status: StoredRelease["status"] = "first",
    ): StoredRelease => ({
      status,
      previous: null,
      entries: [],
      truncated: false,
      computedAt,
    });

    test("GivenANewDeployment_WhenItsReleaseIsCached_ThenItIsStoredAndKeptByFinish", async () => {
      const store = await make();
      const recorded = await store.record(deployment());
      expect(recorded.release).toBeNull();
      const cached = await store.cacheRelease(recorded.id, stored(at(1)));
      expect(cached.release).toEqual(stored(at(1)));
      expect((await store.get(recorded.id))?.release).toEqual(stored(at(1)));
      const done = await store.finish(recorded.id, { status: "succeeded", finishedAt: at(2) });
      expect(done.release).toEqual(stored(at(1)));
    });

    test("GivenACachedRelease_WhenCachedAgain_ThenTheFirstIsKept", async () => {
      const store = await make();
      const recorded = await store.record(deployment());
      await store.cacheRelease(recorded.id, stored(at(1)));
      const again = await store.cacheRelease(recorded.id, stored(at(2), "same_commit"));
      expect(again.release).toEqual(stored(at(1)));
      expect((await store.get(recorded.id))?.release).toEqual(stored(at(1)));
    });

    test("GivenAnUnknownDeployment_WhenItsReleaseIsCached_ThenNotFound", async () => {
      const store = await make();
      await expect(store.cacheRelease("missing", stored(at(1)))).rejects.toMatchObject({
        name: "WorkTrackerError",
        code: "not_found",
      });
    });

    test("GivenSucceededFailedAndStartedDeployments_WhenTheLatestGoodIsAsked_ThenTheNewestSucceeded", async () => {
      const store = await make();
      const env: DeploymentEnvironment = "prod";
      const old = await store.record(deployment({ startedAt: at(1) }));
      await store.finish(old.id, { status: "succeeded", finishedAt: at(2) });
      const good = await store.record(deployment({ startedAt: at(3) }));
      await store.finish(good.id, { status: "succeeded", finishedAt: at(4) });
      const bad = await store.record(deployment({ startedAt: at(5) }));
      await store.finish(bad.id, { status: "failed", finishedAt: at(6) });
      await store.record(deployment({ startedAt: at(7) }));
      await store.record(deployment({ environment: "dev", startedAt: at(8) }));
      expect((await store.latestGood("ai", env))?.id).toBe(good.id);
      expect(await store.latestGood("ai", "dev")).toBeNull();
      expect(await store.latestGood("other", env)).toBeNull();
    });
  });
}
