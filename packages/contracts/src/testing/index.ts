import { describe, expect, it } from "vitest";
import { QuotaReading } from "../entities";
import {
  RunHandle,
  RunReport,
  WorkItem,
  type Executor,
  type QuotaSource,
  type RunRequest,
  type WorkTracker,
} from "../ports";

/**
 * Contract suites: every adapter for a port must pass its suite.
 * Real adapters call these from their own test files with a factory that
 * points at a sandbox (e.g., a scratch GitHub repo). Fakes run them in CI.
 */

export function workTrackerContract(
  name: string,
  make: () => Promise<{ tracker: WorkTracker; projectRef: string }>,
): void {
  describe(`WorkTracker contract: ${name}`, () => {
    it("creates items in backlog and reads them back", async () => {
      const { tracker, projectRef } = await make();
      const created = await tracker.create({ projectRef, type: "story", title: "T", body: "B" });
      expect(WorkItem.parse(created)).toEqual(created);
      expect(created.stage).toBe("backlog");
      expect(await tracker.get(created.ref)).toEqual(created);
    });

    it("returns null for unknown refs", async () => {
      const { tracker, projectRef } = await make();
      expect(await tracker.get(`${projectRef}#does-not-exist`)).toBeNull();
    });

    it("moves stage and reflects it in list()", async () => {
      const { tracker, projectRef } = await make();
      const created = await tracker.create({ projectRef, type: "task", title: "T", body: "" });
      await tracker.setStage(created.ref, "ready");
      const listed = await tracker.list(projectRef);
      expect(listed.find((i) => i.ref === created.ref)?.stage).toBe("ready");
    });

    it("rejects comments on unknown items", async () => {
      const { tracker, projectRef } = await make();
      await expect(tracker.comment(`${projectRef}#nope`, "x")).rejects.toThrow();
    });
  });
}

export function executorContract(
  name: string,
  make: () => Promise<{ executor: Executor; request: (runId: string) => RunRequest }>,
): void {
  describe(`Executor contract: ${name}`, () => {
    it("starts a run and reports a valid status", async () => {
      const { executor, request } = await make();
      const handle = await executor.start(request("run-1"));
      expect(RunHandle.parse(handle).runId).toBe("run-1");
      const report = await executor.status(handle);
      expect(RunReport.parse(report).runId).toBe("run-1");
    });

    it("is idempotent by runId", async () => {
      const { executor, request } = await make();
      const a = await executor.start(request("run-2"));
      const b = await executor.start(request("run-2"));
      expect(b.externalId).toBe(a.externalId);
    });

    it("cancel leaves the run in a terminal state", async () => {
      const { executor, request } = await make();
      const handle = await executor.start(request("run-3"));
      await executor.cancel(handle);
      const { status } = await executor.status(handle);
      expect(["cancelled", "succeeded", "failed"]).toContain(status);
    });
  });
}

export function quotaSourceContract(
  name: string,
  make: () => Promise<{ source: QuotaSource; seed?: () => Promise<void> }>,
): void {
  describe(`QuotaSource contract: ${name}`, () => {
    it("returns schema-valid readings (possibly empty = unknown)", async () => {
      const { source, seed } = await make();
      await seed?.();
      const readings = await source.latest("claude-sub");
      for (const r of readings) expect(QuotaReading.parse(r)).toEqual(r);
    });
  });
}
