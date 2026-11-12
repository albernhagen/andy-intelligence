import {
  InMemoryRunnerStore,
  InMemoryWatchdogQueue,
  type MintedRunner,
  type RunnerClaimResponse,
} from "@andy/contracts";
import { LEASE_LOST_ERROR } from "@andy/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_URL, REPO, createdApp, githubApp } from "./github/test-app";
import { RUNNER_CLAIM_PATH } from "./runners";

/**
 * AI-79 (ADR-0089 slice 4): claim, lease and routing, end to end in-process with a script as the
 * local runner: the real API, domain and dispatchers; GitHub and Cloud Tasks faked. The queue's
 * checks are delivered by hand with the invoker's token.
 */

const INVOKER = "invoker-token";

async function setup() {
  let now = new Date("2026-11-11T12:00:00.000Z");
  const clock = () => now;
  const queue = new InMemoryWatchdogQueue();
  const store = new InMemoryRunnerStore(clock);
  const t = githubApp(
    { now: clock },
    {
      runners: store,
      watchdog: {
        queue,
        publicUrl: PUBLIC_URL,
        invokerEmail: "tasks-invoker@example.iam.gserviceaccount.com",
        verifyInvokerToken: async (jwt) => {
          if (jwt !== INVOKER) throw new Error("bad token");
        },
      },
    },
  );
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
  const send = (path: string, method: string, body?: unknown, token: string | null = "andy") =>
    t.call(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, token);

  const project = await json<{ id: string }>(
    send("/api/projects", "POST", { name: "AI", key: "AI", repos: [REPO] }),
  );
  const projectPath = `/api/projects/${project.id}`;
  await send(projectPath, "PATCH", { autoRefine: false });
  await send(projectPath, "PATCH", { buildEnabled: true });
  await send(projectPath, "PATCH", { autoBuild: true });

  /** A ticket that meets the Definition of Ready, with its executor set, moved to Ready. */
  const readyTicket = async (title: string, executor: "local" | "actions" | null = null) => {
    const ticket = await json<{ id: string; key: string }>(
      send(`${projectPath}/tickets`, "POST", {
        type: "feature",
        title,
        body: "Andy can't see his tickets.",
        acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
        size: "S",
        sizeReason: "one screen",
      }),
    );
    const path = `${projectPath}/tickets/${ticket.id}`;
    if (executor) await send(`${path}/executor`, "PUT", { executor });
    expect((await send(`${path}/stage`, "POST", { to: "ready" })).status).toBe(200);
    return { ...ticket, path };
  };

  const mint = async () =>
    json<MintedRunner>(send("/api/runners", "POST", { name: "Mac", projectIds: [project.id] }));
  const claim = async (secret: string) => {
    const res = await send(RUNNER_CLAIM_PATH, "POST", {}, secret);
    expect(res.status).toBe(200);
    return ((await res.json()) as RunnerClaimResponse).run;
  };
  /** Delivers the queue's lease and runner-away checks due now; returns their outcomes. */
  const deliverDue = async () => {
    const outcomes: string[] = [];
    for (const check of queue.takeDue(now)) {
      const path =
        check.kind === "lease" ? `/runs/${check.runId}/lease` : `/runners/${check.runnerId}/away`;
      outcomes.push(
        `${check.kind}:${(await json<{ outcome: string }>(send(path, "POST", undefined, INVOKER))).outcome}`,
      );
    }
    return outcomes;
  };
  return {
    t,
    json,
    send,
    projectPath,
    readyTicket,
    mint,
    claim,
    deliverDue,
    advance: (seconds: number) => (now = new Date(now.getTime() + seconds * 1000)),
  };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const runsOf = (s: Ctx, path: string) =>
  s.json<{ id: string; status: string; error: string | null; localRun: unknown }[]>(
    s.t.call(`${path}/runs`),
  );

describe("local executor: claim, lease and routing", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenALocalTicket_WhenAPresentRunnerClaims_ThenExactlyOneRunStartsAndASecondClaimGetsNothing", async () => {
    const s = await setup();
    const ticket = await s.readyTicket("Board", "local");
    // No runner yet: the ticket waits and nothing went to Actions.
    expect(await runsOf(s, ticket.path)).toEqual([]);
    const { secret, runner } = await s.mint();

    const claimed = await s.claim(secret);

    expect(claimed).toMatchObject({ step: "build", ticketKey: ticket.key, repo: REPO });
    expect(claimed!.token).toMatch(/^airt_/);
    expect(s.t.host.workflowRuns.size).toBe(0);
    const [run] = await runsOf(s, ticket.path);
    expect(run).toMatchObject({
      id: claimed!.runId,
      status: "queued",
      localRun: { runnerId: runner.id },
    });
    expect((await s.json<{ stage: string }>(s.t.call(ticket.path))).stage).toBe("in_progress");

    s.advance(10);
    expect(await s.claim(secret)).toBeNull();
    expect(await runsOf(s, ticket.path)).toHaveLength(1);
  });

  it("GivenAClaimedRun_WhenTheRunnerFetchesContextAndHeartbeats_ThenItRunsAndTheLeaseRenews", async () => {
    const s = await setup();
    const ticket = await s.readyTicket("Board", "local");
    const { secret } = await s.mint();
    const claimed = (await s.claim(secret))!;
    const asRun = (path: string, method = "GET", body?: unknown) =>
      s.send(path, method, body, claimed.token);

    const context = await s.json<{ step: string; prompt: string; branch: string }>(
      asRun(`/runs/${claimed.runId}/context`),
    );
    expect(context).toMatchObject({
      step: "build",
      branch: `agent/${ticket.key}/${claimed.runId}`,
    });
    expect((await runsOf(s, ticket.path))[0]?.status).toBe("running");
    // The token is bound to its run.
    expect((await asRun("/runs/another-run/context")).status).toBe(401);

    s.advance(60);
    const beat = await asRun(`/runs/${claimed.runId}/heartbeat`, "POST", { phase: "agent" });
    expect(await beat.json()).toEqual({
      cancel: false,
      leaseExpiresAt: "2026-11-11T12:06:00.000Z",
    });

    // The first lease check (at the claim's lease end) finds it renewed and re-queues itself.
    s.advance(240);
    expect(await s.deliverDue()).toContain("lease:renewed");
  });

  it("GivenAClaimedRun_WhenHeartbeatsStopPastTheLease_ThenItFailsAsLeaseLostWithNeedsYouAndNoRetry", async () => {
    const s = await setup();
    const ticket = await s.readyTicket("Board", "local");
    const { secret } = await s.mint();
    const claimed = (await s.claim(secret))!;
    await s.send(`/runs/${claimed.runId}/context`, "GET", undefined, claimed.token);

    // The laptop sleeps: no heartbeat, the lease runs out.
    s.advance(301);
    expect(await s.deliverDue()).toContain("lease:lost");

    const runs = await runsOf(s, ticket.path);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "failed", error: LEASE_LOST_ERROR });
    expect((await s.json<{ needsAttention: boolean }>(s.t.call(ticket.path))).needsAttention).toBe(
      true,
    );
    const events = await s.json<{ body: string | null }[]>(s.t.call(`${ticket.path}/events`));
    expect(events.some((e) => e.body?.includes("Local run lost: the runner went away"))).toBe(true);
    expect(s.t.host.workflowRuns.size).toBe(0);

    // The laptop wakes: its heartbeat is refused and its report changes nothing.
    const late = await s.send(`/runs/${claimed.runId}/heartbeat`, "POST", {}, claimed.token);
    expect(late.status).toBe(409);
    const report = await s.send(
      `/runs/${claimed.runId}/report`,
      "POST",
      { status: "succeeded", summary: "done", tokensIn: 1, tokensOut: 1, costUsd: null },
      claimed.token,
    );
    expect(await report.json()).toEqual({ result: "duplicate" });
  });

  it("GivenAClaimedRun_WhenAndyCancelsTheTicket_ThenTheNextHeartbeatSaysCancel", async () => {
    const s = await setup();
    const ticket = await s.readyTicket("Board", "local");
    const { secret } = await s.mint();
    const claimed = (await s.claim(secret))!;
    await s.send(`/runs/${claimed.runId}/context`, "GET", undefined, claimed.token);

    expect((await s.send(`${ticket.path}/cancel`, "POST", { reason: "not needed" })).status).toBe(
      200,
    );

    const beat = await s.send(`/runs/${claimed.runId}/heartbeat`, "POST", {}, claimed.token);
    expect(await beat.json()).toEqual({ cancel: true, leaseExpiresAt: null });
    const report = await s.send(
      `/runs/${claimed.runId}/report`,
      "POST",
      { status: "cancelled", summary: null, tokensIn: null, tokensOut: null, costUsd: null },
      claimed.token,
    );
    expect(await report.json()).toEqual({ result: "duplicate" });
  });

  it("GivenALocalRunThatReportsAFailure_WhenRecorded_ThenItIsFlaggedAndNotRetried", async () => {
    const s = await setup();
    const ticket = await s.readyTicket("Board", "local");
    const { secret } = await s.mint();
    const claimed = (await s.claim(secret))!;
    await s.send(`/runs/${claimed.runId}/context`, "GET", undefined, claimed.token);

    const report = await s.send(
      `/runs/${claimed.runId}/report`,
      "POST",
      { status: "failed", summary: "tests failed", tokensIn: 5, tokensOut: 5, costUsd: null },
      claimed.token,
    );

    expect(await report.json()).toEqual({ result: "recorded" });
    expect(await runsOf(s, ticket.path)).toMatchObject([{ status: "failed" }]);
    expect((await s.json<{ needsAttention: boolean }>(s.t.call(ticket.path))).needsAttention).toBe(
      true,
    );
  });

  it("GivenARevokedRunner_WhenItsRunCallsBack_Then401", async () => {
    const s = await setup();
    await s.readyTicket("Board", "local");
    const { secret, runner } = await s.mint();
    const claimed = (await s.claim(secret))!;

    await s.send(`/api/runners/${runner.id}/revoke`, "POST");

    const beat = await s.send(`/runs/${claimed.runId}/heartbeat`, "POST", {}, claimed.token);
    expect(beat.status).toBe(401);
  });

  it("GivenNoRunnerPresent_WhenTicketsAreReady_ThenTheProjectDefaultGoesToActionsAndTheOverrideWaits", async () => {
    const s = await setup();
    await s.send(s.projectPath, "PATCH", { executor: "local" });

    const followsDefault = await s.readyTicket("Board");
    const overridden = await s.readyTicket("Inbox", "local");

    expect(await runsOf(s, followsDefault.path)).toMatchObject([
      { status: "queued", localRun: null },
    ]);
    expect(s.t.host.workflowRuns.size).toBe(1);
    expect(await runsOf(s, overridden.path)).toEqual([]);
    const view = await s.json<{ next: string }>(s.t.call(`${overridden.path}/executor`));
    expect(view.next).toBe("wait");
  });

  it("GivenAPresentRunner_WhenALocalDefaultTicketIsReady_ThenActionsSkipsItUntilTheRunnerIsAway", async () => {
    const s = await setup();
    await s.send(s.projectPath, "PATCH", { executor: "local" });
    const { secret } = await s.mint();
    expect(await s.claim(secret)).toBeNull();

    const ticket = await s.readyTicket("Board");
    expect(await runsOf(s, ticket.path)).toEqual([]);
    expect(s.t.host.workflowRuns.size).toBe(0);

    // The runner stops polling; 2 minutes later the away check wakes the dispatchers.
    s.advance(125);
    expect(await s.deliverDue()).toContain("runner_away:woken");
    expect(s.t.host.workflowRuns.size).toBe(1);
    expect(await runsOf(s, ticket.path)).toMatchObject([{ localRun: null }]);
  });

  it("GivenALocalTicket_WhenAndyStartsItByHand_ThenRefusedBecauseTheRunnerTakesIt", async () => {
    const s = await setup();
    const ticket = await s.readyTicket("Board", "local");

    const res = await s.send(`${ticket.path}/runs`, "POST", { step: "build" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: `${ticket.key} waits for the local runner` });
  });
});
