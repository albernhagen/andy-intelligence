import { describe, expect, it } from "vitest";
import {
  MintRunner,
  RunHeartbeatRequest,
  RunReportRequest,
  Runner,
  RunnerClaimResponse,
  runnerIsActive,
} from "./runner";

describe("runner wire schemas", () => {
  it("GivenNoWork_WhenAClaimResponseIsParsed_ThenRunIsNullWithTheTimings", () => {
    expect(RunnerClaimResponse.parse({ run: null, pollSeconds: 30, heartbeatSeconds: 60 })).toEqual(
      { run: null, pollSeconds: 30, heartbeatSeconds: 60 },
    );
  });

  it("GivenAClaimedRun_WhenParsed_ThenEveryFieldTheRunnerNeedsIsThere", () => {
    const run = {
      runId: "run-1",
      token: "t",
      step: "refine",
      ticketKey: "AI-1",
      repo: "albernhagen/andy-intelligence",
      deadline: "2026-11-11T13:00:00.000Z",
      leaseExpiresAt: "2026-11-11T12:05:00.000Z",
    };
    expect(RunnerClaimResponse.parse({ run, pollSeconds: 30, heartbeatSeconds: 60 }).run).toEqual(
      run,
    );
  });

  it("GivenAnUnknownField_WhenAHeartbeatIsParsed_ThenRejected", () => {
    expect(RunHeartbeatRequest.safeParse({ phase: "agent" }).success).toBe(true);
    expect(RunHeartbeatRequest.safeParse({ cancel: true }).success).toBe(false);
  });

  it("GivenACancelledReport_WhenParsed_ThenAccepted", () => {
    const base = { summary: null, tokensIn: null, tokensOut: null, costUsd: null };
    expect(RunReportRequest.safeParse({ ...base, status: "cancelled" }).success).toBe(true);
    expect(RunReportRequest.safeParse({ ...base, status: "queued" }).success).toBe(false);
  });

  it("GivenAMintWithThreeRunsAtOnce_WhenParsed_ThenRejectedByTheCap", () => {
    expect(MintRunner.safeParse({ name: "Mac", projectIds: ["ai"], runsAtOnce: 3 }).success).toBe(
      false,
    );
    expect(MintRunner.safeParse({ name: "Mac", projectIds: [] }).success).toBe(false);
  });
});

describe("runnerIsActive", () => {
  const runner = Runner.parse({
    id: "r1",
    name: "Mac",
    projectIds: ["ai"],
    createdAt: "2026-11-11T12:00:00.000Z",
    createdBy: "user:uid-1",
    expiresAt: "2027-02-09T12:00:00.000Z",
  });
  const now = new Date("2026-11-11T12:00:00.000Z");

  it("GivenAFreshRunner_WhenChecked_ThenActive", () => {
    expect(runnerIsActive(runner, now)).toBe(true);
  });

  it("GivenARevokedOrExpiredRunner_WhenChecked_ThenNotActive", () => {
    expect(runnerIsActive({ ...runner, revokedAt: now.toISOString() }, now)).toBe(false);
    expect(runnerIsActive(runner, new Date("2027-02-09T12:00:00.000Z"))).toBe(false);
  });
});
