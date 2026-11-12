import {
  InMemoryRunStore,
  InMemoryRunnerStore,
  InMemoryWatchdogQueue,
  InMemoryWorkTracker,
  type Runner,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { wasDispatched } from "./dispatch-caps";
import { routeTakes } from "./executor";
import { LocalClaims } from "./local-claims";
import { RefineDispatcher } from "./refine-dispatch";
import { RunnerService } from "./runners";
import { LEASE_LOST_ERROR, RunService } from "./runs";

/** ADR-0089 slice 4: claims, leases and the routing rules, on in-memory adapters. */

const START = new Date("2026-11-11T12:00:00.000Z");

async function setup() {
  let now = START;
  const clock = () => now;
  const tracker = new InMemoryWorkTracker(clock);
  const runStore = new InMemoryRunStore(clock);
  const queue = new InMemoryWatchdogQueue();
  let n = 0;
  const runners = new RunnerService(
    new InMemoryRunnerStore(clock),
    tracker,
    { newSecret: () => `s-${++n}`, newRunToken: () => `t-${++n}`, hash: (x) => `h(${x})` },
    clock,
  );
  // No cloud executor: local runs need none.
  const runs = new RunService(tracker, runStore, null, clock, queue, null, null, (projectId) =>
    runners.presentFor(projectId),
  );
  const refiner = new RefineDispatcher(tracker, runStore, runs, clock);
  const builder = new BuildDispatcher(tracker, runStore, runs, clock);
  const claims = new LocalClaims(tracker, runStore, runs, runners, builder, refiner, queue, clock);
  const project = await tracker.createProject({
    name: "AI",
    key: "AI",
    repos: ["albernhagen/andy-intelligence"],
  });
  /** An Up-next ticket refine would take, overriding to `local`. */
  const upNext = async (title: string) => {
    const t = await tracker.createTicket(
      project.id,
      { type: "feature", title, overrides: { executor: "local" } },
      "andy",
    );
    return tracker.updateTicket(
      project.id,
      t.id,
      { fields: { upNextRank: title, upNextAt: now.toISOString() } },
      "andy",
    );
  };
  const { secret } = await runners.mint({ name: "Mac", projectIds: [project.id] }, "andy");
  const runner = (await runners.authenticate(secret))!;
  await runners.recordClaim(runner);
  return {
    tracker,
    runStore,
    queue,
    runs,
    runners,
    claims,
    project,
    runner,
    upNext,
    advance: (seconds: number) => (now = new Date(now.getTime() + seconds * 1000)),
  };
}

describe("routeTakes", () => {
  const runner = { projectIds: ["ai"] } as Runner;
  const project = { id: "ai", executor: "actions" as const };
  const local = { overrides: { executor: "local" as const } };

  it("GivenALocalTicket_WhenTheRunnerIsPresent_ThenOnlyTheRunnerTakesIt", () => {
    expect(routeTakes({ kind: "actions" }, local, project, true)).toBe(false);
    expect(routeTakes({ kind: "local", runner }, local, project, true)).toBe(true);
  });

  it("GivenALocalOverride_WhenNoRunnerIsPresent_ThenActionsDoesntTakeIt", () => {
    expect(routeTakes({ kind: "actions" }, local, project, false)).toBe(false);
  });

  it("GivenAnActionsTicketOrAnotherProject_WhenTheRunnerClaims_ThenItIsNotTaken", () => {
    expect(routeTakes({ kind: "local", runner }, { overrides: {} }, project, true)).toBe(false);
    expect(routeTakes({ kind: "local", runner }, local, { ...project, id: "ops" }, true)).toBe(
      false,
    );
  });
});

describe("wasDispatched", () => {
  it("GivenALocalRunWithNoCloudExecutor_WhenCounted_ThenItCounts", () => {
    const localRun = { runnerId: "r", leaseExpiresAt: START.toISOString(), heartbeatAt: null };
    expect(wasDispatched({ executor: null, localRun })).toBe(true);
    expect(wasDispatched({ executor: null, localRun: null })).toBe(false);
  });
});

describe("LocalClaims", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenALocalUpNextTicket_WhenTheRunnerClaims_ThenARefineRunIsClaimedWithAToken", async () => {
    const s = await setup();
    const ticket = await s.upNext("A");

    const claimed = await s.claims.claim(s.runner);

    expect(claimed).toMatchObject({ step: "refine", ticketKey: ticket.key, token: "t-2" });
    const run = (await s.runStore.get(claimed!.runId))!;
    expect(run.localRun).toEqual({
      runnerId: s.runner.id,
      leaseExpiresAt: "2026-11-11T12:05:00.000Z",
      heartbeatAt: null,
    });
    expect(await s.runners.authenticateRun("t-2", run.id)).toEqual({ runnerId: s.runner.id });
    expect(await s.runners.authenticateRun("t-2", "other")).toBeNull();
    expect([...s.queue.queued.values()].map((c) => c.kind).sort()).toEqual([
      "lease",
      "runner_away",
    ]);
  });

  it("GivenClaimsWithinOneMinute_WhenEachQueuesItsAwayCheck_ThenOnlyOneCheckIsQueued", async () => {
    const s = await setup();
    await s.claims.claim(s.runner);
    s.advance(10);
    await s.claims.claim(s.runner);
    s.advance(20);
    await s.claims.claim(s.runner);

    const away = [...s.queue.queued.values()].filter((c) => c.kind === "runner_away");
    expect(away.length).toBeLessThanOrEqual(1);
  });

  it("GivenARunnerAtItsRunsAtOnce_WhenItClaims_ThenNothing", async () => {
    const s = await setup();
    await s.upNext("A");
    await s.claims.claim(s.runner);
    await s.upNext("B");

    expect(await s.claims.claim(s.runner)).toBeNull();
  });

  it("GivenAnActionsTicket_WhenTheRunnerClaims_ThenNothing", async () => {
    const s = await setup();
    const t = await s.tracker.createTicket(s.project.id, { type: "feature", title: "A" }, "andy");
    await s.tracker.updateTicket(
      s.project.id,
      t.id,
      { fields: { upNextRank: "a", upNextAt: START.toISOString() } },
      "andy",
    );

    expect(await s.claims.claim(s.runner)).toBeNull();
  });
});

describe("local run lease and heartbeat", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAHeartbeat_WhenTheLeaseCheckArrivesEarly_ThenEarlyWithoutAnotherQueuedCheck", async () => {
    const s = await setup();
    await s.upNext("A");
    const claimed = (await s.claims.claim(s.runner))!;
    const caller = { runnerId: s.runner.id };

    s.advance(60);
    expect(await s.runs.heartbeat(claimed.runId, caller)).toEqual({
      cancel: false,
      leaseExpiresAt: "2026-11-11T12:06:00.000Z",
    });
    // Delivered at the claim's lease end: renewed, the next check goes to 12:06.
    s.advance(240);
    expect(await s.runs.checkLease(claimed.runId)).toBe("renewed");
    // Delivered again before 12:06 (a redelivery): the check is already queued.
    expect(await s.runs.checkLease(claimed.runId)).toBe("early");
  });

  it("GivenALapsedLease_WhenChecked_ThenLeaseLostNeedsYouAndNoNewRun", async () => {
    const s = await setup();
    const ticket = await s.upNext("A");
    const claimed = (await s.claims.claim(s.runner))!;

    s.advance(300);
    expect(await s.runs.checkLease(claimed.runId)).toBe("lost");

    expect(await s.runStore.get(claimed.runId)).toMatchObject({
      status: "failed",
      error: LEASE_LOST_ERROR,
    });
    expect((await s.tracker.getTicket(s.project.id, ticket.id))?.needsAttention).toBe(true);
    expect(await s.runStore.listForTicket(s.project.id, ticket.id)).toHaveLength(1);
    expect(await s.runs.checkLease(claimed.runId)).toBe("settled");
    await expect(s.runs.heartbeat(claimed.runId, { runnerId: s.runner.id })).rejects.toMatchObject({
      code: "run_finished",
    });
  });

  it("GivenAnotherRunner_WhenItHeartbeatsTheRun_ThenForbidden", async () => {
    const s = await setup();
    await s.upNext("A");
    const claimed = (await s.claims.claim(s.runner))!;

    await expect(s.runs.heartbeat(claimed.runId, { runnerId: "other" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("GivenALocalRunPastItsDeadline_WhenTheWatchdogLooks_ThenFailedAndFlaggedWithoutRetry", async () => {
    const s = await setup();
    const ticket = await s.upNext("A");
    const claimed = (await s.claims.claim(s.runner))!;

    s.advance(46 * 60);
    expect(await s.runs.checkDeadline(claimed.runId)).toBe("flagged");

    expect(await s.runStore.get(claimed.runId)).toMatchObject({
      status: "failed",
      error: "the run passed its deadline",
    });
    expect(await s.runStore.listForTicket(s.project.id, ticket.id)).toHaveLength(1);
  });
});

describe("retry routing", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAnActionsRunThatFailed_WhenItsTicketNowResolvesToLocal_ThenTheRetryStaysOnActions", async () => {
    let now = START;
    const tracker = new InMemoryWorkTracker(() => now);
    const runStore = new InMemoryRunStore(() => now);
    let started = 0;
    const executor = {
      start: async (req: { runId: string }) => ({
        runId: req.runId,
        externalId: `wf-${++started}`,
        url: null,
        executor: {
          repo: "albernhagen/andy-intelligence",
          ref: "ref",
          externalId: `wf-${started}`,
        },
      }),
      status: async () => ({ status: "failed" }) as never,
      cancel: async () => {},
    };
    let present = false;
    const runs = new RunService(
      tracker,
      runStore,
      executor,
      () => now,
      null,
      null,
      null,
      async () => present,
    );
    const project = await tracker.createProject({
      name: "AI",
      key: "AI",
      repos: ["albernhagen/andy-intelligence"],
    });
    await tracker.updateProject(project.id, { executor: "local" });
    const t = await tracker.createTicket(project.id, { type: "feature", title: "A" }, "andy");
    await tracker.updateTicket(
      project.id,
      t.id,
      { fields: { upNextRank: "a", upNextAt: START.toISOString() } },
      "andy",
    );
    // The runner is away, so the refine goes to Actions; then the runner comes back.
    const first = await runs.start(project.id, t.id, "refine");
    present = true;
    now = new Date(START.getTime() + 60_000);

    await runs.report(first.id, first.executor!, {
      status: "failed",
      summary: "boom",
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
    });

    const all = await runStore.listForTicket(project.id, t.id);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ attempt: 2, localRun: null, status: "queued" });
  });
});

describe("runner away", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenARunnerThatClaimedRecently_WhenTheAwayCheckArrives_ThenPresentAndNothingWakes", async () => {
    const s = await setup();
    const wake = vi.fn(async () => null);

    expect(await s.runners.checkAway(s.runner.id, wake)).toBe("present");
    expect(wake).not.toHaveBeenCalled();
  });

  it("GivenARunnerSilentFor2Minutes_WhenTheAwayCheckArrives_ThenItsProjectsWake", async () => {
    const s = await setup();
    const wake = vi.fn(async () => null);
    s.advance(125);

    expect(await s.runners.checkAway(s.runner.id, wake)).toBe("woken");
    expect(wake).toHaveBeenCalledWith(s.project.id);
    expect(await s.runners.checkAway("missing", wake)).toBe("unknown");
  });
});
