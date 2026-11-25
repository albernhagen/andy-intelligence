import type { HeadCheck, RequiredCheck } from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import { mainChecksOf, readMainChecks } from "./merge-facts";

const required: RequiredCheck[] = [
  { name: "ci", sourceId: "15368" },
  { name: "lint", sourceId: null },
  // Required on PRs, never run on a push to the default branch.
  { name: "adversarial-review", sourceId: "15368" },
];
const check = (name: string, over: Partial<HeadCheck> = {}): HeadCheck => ({
  name,
  status: "completed",
  conclusion: "success",
  sourceId: "15368",
  ...over,
});
const listing = (...items: HeadCheck[]) => ({ items, complete: true });

describe("mainChecksOf", () => {
  it("GivenEveryRequiredCheckPassedOnMainsHead_WhenRead_ThenPassedAndReviewChecksAreNotWaitedFor", () => {
    expect(mainChecksOf(required, listing(check("ci"), check("lint")))).toEqual({
      state: "passed",
      failing: [],
    });
  });

  it("GivenARequiredCheckFailed_WhenRead_ThenFailedNamingIt", () => {
    const checks = listing(check("ci", { conclusion: "failure" }), check("lint"));
    expect(mainChecksOf(required, checks)).toEqual({ state: "failed", failing: ["ci"] });
  });

  it("GivenARequiredCheckStillRunningOrNotReportedYet_WhenRead_ThenRunningNotRed", () => {
    const running = listing(check("ci", { status: "in_progress", conclusion: null }));
    expect(mainChecksOf(required, running)).toEqual({ state: "running", failing: [] });
  });

  it("GivenAFailedCheckBeingReRun_WhenRead_ThenRunningNotRed", () => {
    const checks = listing(
      check("ci", { conclusion: "failure" }),
      check("ci", { status: "queued", conclusion: null }),
      check("lint"),
    );
    expect(mainChecksOf(required, checks)?.state).toBe("running");
  });

  it("GivenAFailureFromAnUntrustedReporter_WhenRead_ThenItDoesNotCount", () => {
    const checks = listing(check("ci"), check("ci", { conclusion: "failure", sourceId: "999" }));
    expect(mainChecksOf(required, listing(...checks.items, check("lint")))?.state).toBe("passed");
  });

  it("GivenAListingCutShortWithNoFailure_WhenRead_ThenUnknown", () => {
    expect(mainChecksOf(required, { items: [check("ci")], complete: false })).toBeNull();
  });

  it("GivenNoRequiredChecks_WhenRead_ThenPassed", () => {
    expect(mainChecksOf([], listing())).toEqual({ state: "passed", failing: [] });
  });
});

describe("readMainChecks", () => {
  it("GivenNoTip_WhenRead_ThenUnknownWithNoHostRead", async () => {
    const host = { listRequiredChecks: vi.fn(), listHeadChecks: vi.fn() };
    expect(await readMainChecks(host, "o/r", "main", null, "test")).toBeNull();
    expect(host.listHeadChecks).not.toHaveBeenCalled();
  });

  it("GivenAHostReadFails_WhenRead_ThenUnknown", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const host = {
      listRequiredChecks: vi.fn().mockRejectedValue(new Error("502")),
      listHeadChecks: vi.fn().mockResolvedValue(listing()),
    };
    expect(await readMainChecks(host, "o/r", "main", "abc", "test")).toBeNull();
  });

  it("GivenTheTip_WhenRead_ThenTheTipsChecksAreJudged", async () => {
    const host = {
      listRequiredChecks: vi.fn().mockResolvedValue([{ name: "ci", sourceId: null }]),
      listHeadChecks: vi.fn().mockResolvedValue(listing(check("ci", { conclusion: "timed_out" }))),
    };
    expect(await readMainChecks(host, "o/r", "main", "abc", "test")).toEqual({
      state: "failed",
      failing: ["ci"],
    });
    expect(host.listHeadChecks).toHaveBeenCalledWith("o/r", "abc");
  });
});
