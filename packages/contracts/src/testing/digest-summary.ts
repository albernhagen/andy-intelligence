import { describe, expect, it } from "vitest";
import type {
  DigestSummaryDispatch,
  DigestSummaryOutput,
  DigestSummaryPeriod,
} from "../entities/digest-summary";
import type { DigestSummaryStore } from "../ports/digest-summary";

/**
 * AI-323, ADR-0137. `make` must return a store with nothing in it, its per-day counts included.
 * Timestamps are UTC with a `Z`.
 */
export function digestSummaryStoreContract(name: string, make: () => Promise<DigestSummaryStore>) {
  describe(`DigestSummaryStore contract: ${name}`, () => {
    const now = "2026-11-22T15:00:00.000Z";
    const later = "2026-11-22T15:05:00.000Z";
    const period = (id = "2026-11-21"): DigestSummaryPeriod => ({
      id,
      timeZone: "America/Denver",
      from: `${id}T07:00:00.000Z`,
      to: "2026-11-22T07:00:00.000Z",
    });
    const dispatch = (runId = "run-1"): DigestSummaryDispatch => ({
      runId,
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      inputHash: "a".repeat(64),
      truncated: false,
    });
    const output: DigestSummaryOutput = {
      summary: "Andy can now read a summary of the day.",
      summaryRefs: { tickets: ["AI-323"], prs: [] },
      lines: [
        {
          heading: "M4: Roadmap",
          epicKey: "AI-200",
          text: "The digest has a summary.",
          refs: { tickets: ["AI-323"], prs: [345] },
        },
      ],
    };

    it("GivenNoSummary_WhenClaimed_ThenItIsWritingWithAttemptOne", async () => {
      const store = await make();
      const claim = await store.claim("ai", period(), 10, now);
      expect(claim.outcome).toBe("claimed");
      expect(claim.summary).toMatchObject({
        id: "2026-11-21",
        projectId: "ai",
        status: "writing",
        attempts: 1,
        runId: null,
        output: null,
        failure: null,
      });
      expect(await store.get("ai", "2026-11-21")).toEqual(claim.summary);
      expect(await store.get("other", "2026-11-21")).toBeNull();
    });

    it("GivenAClaimedDay_WhenClaimedAgain_ThenExistsAndUnchanged", async () => {
      const store = await make();
      const first = await store.claim("ai", period(), 10, now);
      const second = await store.claim("ai", period(), 10, later);
      expect(second).toEqual({ outcome: "exists", summary: first.summary });
    });

    it("GivenTheDaysCapUsed_WhenAnotherProjectClaims_ThenCappedAndNothingStored", async () => {
      const store = await make();
      expect((await store.claim("ai", period(), 1, now)).outcome).toBe("claimed");
      expect(await store.claim("other", period(), 1, now)).toEqual({
        outcome: "capped",
        summary: null,
      });
      expect(await store.get("other", "2026-11-21")).toBeNull();
      // The cap is per UTC day of `now`.
      const nextDay = "2026-11-23T15:00:00.000Z";
      expect((await store.claim("other", period(), 1, nextDay)).outcome).toBe("claimed");
    });

    it("GivenAClaimedSummary_WhenDispatchedThenCompletedByItsTask_ThenReady", async () => {
      const store = await make();
      await store.claim("ai", period(), 10, now);
      const sent = await store.dispatched("ai", "2026-11-21", dispatch(), now);
      expect(sent).toMatchObject({ status: "writing", runId: "run-1" });
      expect(await store.dispatched("ai", "2026-11-21", dispatch("run-2"), now)).toBeNull();
      expect(await store.complete("ai", "2026-11-21", "run-2", output, later)).toBeNull();
      const done = await store.complete("ai", "2026-11-21", "run-1", output, later);
      expect(done).toMatchObject({ status: "ready", output, updatedAt: later });
      expect(await store.get("ai", "2026-11-21")).toEqual(done);
      expect(await store.complete("ai", "2026-11-21", "run-1", output, later)).toBeNull();
    });

    it("GivenAnInvalidOutput_WhenCompleted_ThenRefusedAndStillWriting", async () => {
      const store = await make();
      await store.claim("ai", period(), 10, now);
      await store.dispatched("ai", "2026-11-21", dispatch(), now);
      const bad = { ...output, summaryRefs: { tickets: [], prs: [] } };
      await expect(store.complete("ai", "2026-11-21", "run-1", bad, later)).rejects.toThrow();
      expect((await store.get("ai", "2026-11-21"))?.status).toBe("writing");
    });

    it("GivenARefusedDispatch_WhenFailedWithoutATask_ThenFailedWithTheReason", async () => {
      const store = await make();
      await store.claim("ai", period(), 10, now);
      const failure = { reason: "paused" as const, detail: null };
      expect(await store.fail("ai", "2026-11-21", "run-1", failure, later)).toBeNull();
      const failed = await store.fail("ai", "2026-11-21", null, failure, later);
      expect(failed).toMatchObject({ status: "failed", failure, output: null });
    });

    it("GivenADispatchedTask_WhenFailed_ThenOnlyThatTaskCanFailIt", async () => {
      const store = await make();
      await store.claim("ai", period(), 10, now);
      await store.dispatched("ai", "2026-11-21", dispatch(), now);
      const failure = { reason: "run_failed" as const, detail: "timed out" };
      expect(await store.fail("ai", "2026-11-21", null, failure, later)).toBeNull();
      expect(await store.fail("ai", "2026-11-21", "run-2", failure, later)).toBeNull();
      expect((await store.fail("ai", "2026-11-21", "run-1", failure, later))?.status).toBe(
        "failed",
      );
    });

    it("GivenAFailedSummary_WhenRetried_ThenWritingOnceMoreThenAttemptsUsed", async () => {
      const store = await make();
      expect((await store.retry("ai", "2026-11-21", 10, now)).outcome).toBe("missing");
      await store.claim("ai", period(), 10, now);
      expect((await store.retry("ai", "2026-11-21", 10, now)).outcome).toBe("not_failed");
      const failure = { reason: "run_failed" as const, detail: null };
      await store.fail("ai", "2026-11-21", null, failure, now);
      const retry = await store.retry("ai", "2026-11-21", 10, later);
      expect(retry.outcome).toBe("retried");
      expect(retry.summary).toMatchObject({
        status: "writing",
        attempts: 2,
        runId: null,
        failure: null,
      });
      await store.fail("ai", "2026-11-21", null, failure, later);
      expect((await store.retry("ai", "2026-11-21", 10, later)).outcome).toBe("attempts_used");
    });

    it("GivenADayWhereNothingHappened_WhenRetried_ThenNotFailedAndUnchanged", async () => {
      const store = await make();
      await store.claim("ai", period(), 10, now);
      const quiet = { reason: "nothing_happened" as const, detail: null };
      await store.fail("ai", "2026-11-21", null, quiet, now);
      expect((await store.retry("ai", "2026-11-21", 10, later)).outcome).toBe("not_failed");
      expect((await store.get("ai", "2026-11-21"))?.attempts).toBe(1);
    });

    it("GivenTheDaysCapUsed_WhenRetried_ThenCappedAndStillFailed", async () => {
      const store = await make();
      await store.claim("ai", period(), 1, now);
      await store.fail("ai", "2026-11-21", null, { reason: "paused", detail: null }, now);
      const retry = await store.retry("ai", "2026-11-21", 1, later);
      expect(retry.outcome).toBe("capped");
      expect((await store.get("ai", "2026-11-21"))?.status).toBe("failed");
    });
  });
}
