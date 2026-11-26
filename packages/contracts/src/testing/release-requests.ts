import { describe, expect, it } from "vitest";
import { RELEASE_REQUEST_LIMITS, type NewReleaseRequest } from "../entities/release-request";
import type { ReleaseRequestStore } from "../ports/release-requests";

/** `make` must return a store with nothing in it. */
export function releaseRequestStoreContract(
  name: string,
  make: () => Promise<ReleaseRequestStore>,
  options: { timeoutMs?: number } = {},
): void {
  const test = (title: string, fn: () => Promise<void>) => it(title, fn, options.timeoutMs);
  const gap = RELEASE_REQUEST_LIMITS.minGapMs;

  describe(`ReleaseRequestStore contract: ${name}`, () => {
    const start = Date.parse("2026-11-26T10:00:00.000Z");
    const at = (ms: number) => new Date(start + ms).toISOString();
    const request = (overrides: Partial<NewReleaseRequest> = {}): NewReleaseRequest => ({
      projectId: "ai",
      action: "promote",
      environment: "prod",
      digest: `sha256:${"a".repeat(64)}`,
      revision: null,
      sourceDeploymentId: "dep-1",
      actor: "user:owner",
      createdAt: at(0),
      status: "requested",
      updatedAt: at(0),
      ...overrides,
    });
    const created = async (store: ReleaseRequestStore, overrides: Partial<NewReleaseRequest>) => {
      const result = await store.create(request(overrides), gap);
      if (!("created" in result)) throw new Error("expected the request to be created");
      return result.created;
    };

    test("GivenANewRequest_WhenCreated_ThenItComesBackByIdWithAnIdUsableAsTheWorkflowInput", async () => {
      const store = await make();
      const made = await created(store, {});
      expect(made.id).toMatch(/^[A-Za-z0-9_-]{1,80}$/);
      expect(made).toMatchObject({ projectId: "ai", status: "requested", runId: null });
      expect(await store.get(made.id)).toEqual(made);
      expect(await store.get("missing")).toBeNull();
    });

    test("GivenARequestUnderAMinuteAgo_WhenAnotherIsCreatedForTheSameProject_ThenItIsRefusedAndNothingIsWritten", async () => {
      const store = await make();
      await created(store, {});
      const second = await store.create(request({ createdAt: at(gap - 1) }), gap);
      expect(second).toEqual({ tooSoonUntil: at(gap) });
      expect(await store.list("ai")).toHaveLength(1);
    });

    test("GivenARequestAMinuteAgo_WhenAnotherIsCreated_ThenItIsStored", async () => {
      const store = await make();
      await created(store, {});
      await created(store, { createdAt: at(gap), updatedAt: at(gap) });
      expect(await store.list("ai")).toHaveLength(2);
    });

    test("GivenARecentRequestInAnotherProject_WhenCreated_ThenItIsStored", async () => {
      const store = await make();
      await created(store, {});
      await created(store, { projectId: "web" });
      expect(await store.list("web")).toHaveLength(1);
    });

    test("GivenConcurrentRequests_WhenCreatedTogether_ThenOnlyOneIsStored", async () => {
      const store = await make();
      const results = await Promise.all([
        store.create(request(), gap),
        store.create(request({ createdAt: at(1) }), gap),
      ]);
      expect(results.filter((r) => "created" in r)).toHaveLength(1);
      expect(await store.list("ai")).toHaveLength(1);
    });

    test("GivenARequest_WhenUpdatedFromItsStatus_ThenTheChangeIsStored", async () => {
      const store = await make();
      const made = await created(store, {});
      const next = await store.update(
        made.id,
        {
          status: "dispatched",
          runId: "123",
          runUrl: "https://example.test/runs/123",
          updatedAt: at(5),
        },
        ["requested"],
      );
      expect(next).toEqual({
        ...made,
        status: "dispatched",
        runId: "123",
        runUrl: "https://example.test/runs/123",
        updatedAt: at(5),
      });
      expect(await store.get(made.id)).toEqual(next);
    });

    test("GivenARequestInAnotherStatus_WhenUpdated_ThenConflictAndNothingChanges", async () => {
      const store = await make();
      const made = await created(store, {});
      await expect(
        store.update(made.id, { status: "succeeded", updatedAt: at(5) }, ["started"]),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(await store.get(made.id)).toEqual(made);
      await expect(
        store.update("missing", { status: "succeeded", updatedAt: at(5) }, ["started"]),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    test("GivenALongError_WhenUpdated_ThenItIsCutToTheCap", async () => {
      const store = await make();
      const made = await created(store, {});
      const next = await store.update(
        made.id,
        { status: "dispatch_failed", error: "x".repeat(2_000), updatedAt: at(1) },
        ["requested"],
      );
      expect(next.error).toHaveLength(RELEASE_REQUEST_LIMITS.error);
    });

    test("GivenManyRequests_WhenListed_ThenNewestFirstAndCapped", async () => {
      const store = await make();
      for (let i = 0; i < RELEASE_REQUEST_LIMITS.maxPage + 1; i++) {
        const t = at(i * gap);
        await created(store, { createdAt: t, updatedAt: t });
      }
      const page = await store.list("ai", 1_000);
      expect(page).toHaveLength(RELEASE_REQUEST_LIMITS.maxPage);
      expect(page[0]?.createdAt).toBe(at(RELEASE_REQUEST_LIMITS.maxPage * gap));
      expect(await store.list("ai")).toHaveLength(RELEASE_REQUEST_LIMITS.defaultPage);
      expect(await store.list("ai", 2)).toHaveLength(2);
    });
  });
}
