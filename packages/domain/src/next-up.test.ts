import { buildRun, DIGEST_NEXT_UP_MAX, type Run, type Ticket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { MAX_BUILD_RUNS_PER_TICKET } from "./builds";
import { MAX_ACTIVE_RUNS_GLOBAL, MAX_PRS_WAITING_PER_PROJECT } from "./dispatch-caps";
import { nextUp, readySkip, type DispatchFacts, type NextUpInput } from "./next-up";

const NOW = new Date("2026-11-27T12:00:00.000Z");

const ticket = (n: number, over: Partial<Ticket> = {}): Ticket =>
  ({
    id: `t${n}`,
    projectId: "ai",
    key: `AI-${n}`,
    title: `Ticket ${n}`,
    type: "feature",
    body: "Andy can't see it.",
    acceptanceCriteria: ["The system shall show it."],
    size: "S",
    sizeReason: "one screen",
    stage: "ready",
    rank: String(n).padStart(10, "0"),
    archived: false,
    needsAttention: false,
    blockedBy: [],
    touches: [`areas/${n}/**`],
    overrides: {},
    parentId: null,
    milestoneId: null,
    updatedAt: NOW.toISOString(),
    ...over,
  }) as Ticket;

const run = (ticketId: string, over: Partial<Run> = {}): Run => ({
  ...buildRun(
    {
      projectId: "ai",
      ticketId,
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: null,
    },
    over.id ?? `r-${ticketId}`,
    NOW,
  ),
  status: "running",
  ...over,
});

const project = {
  id: "ai",
  key: "AI",
  autoBuild: true,
  buildEnabled: true,
  paused: false,
  runsAtOnce: 2,
  defaultWorker: "agent" as const,
  executor: "actions" as const,
  planApproval: "none" as const,
};

const facts: DispatchFacts = {
  canDispatch: true,
  runnerPresent: false,
  globalActive: 0,
  quotaLevel: "ok",
};

const input = (over: Partial<NextUpInput> = {}): NextUpInput => ({
  project,
  tickets: [],
  openQuestions: new Map(),
  activeRuns: [],
  ticketRuns: new Map(),
  milestoneHolds: new Map(),
  facts,
  now: NOW,
  ...over,
});

const statuses = (r: ReturnType<typeof nextUp>) => r.items.map((i) => `${i.ticketKey} ${i.status}`);

describe("nextUp", () => {
  it("GivenReadyTicketsOutOfOrder_WhenDryRun_ThenListedInRankOrderUpToTheDial", () => {
    const tickets = [ticket(3), ticket(1), ticket(2)];
    const r = nextUp(input({ tickets }));
    expect(statuses(r)).toEqual(["AI-1 starts_now", "AI-2 starts_now", "AI-3 next"]);
    expect(r.idle).toBe(
      "2 tickets would start; then: Dispatch is at the project's dial (2 agent tasks at once)",
    );
  });

  it("GivenAnEpicAndAnArchivedTicketInReady_WhenDryRun_ThenNeitherIsListed", () => {
    const r = nextUp(
      input({ tickets: [ticket(1, { type: "epic" }), ticket(2, { archived: true }), ticket(3)] }),
    );
    expect(statuses(r)).toEqual(["AI-3 starts_now"]);
  });

  it("GivenAnOpenBlocker_WhenDryRun_ThenSkippedNamingTheBlockerAndItsStage", () => {
    const blocker = ticket(1, { stage: "in_progress", title: "Ticket core" });
    const r = nextUp(input({ tickets: [blocker, ticket(2, { blockedBy: ["AI-1"] })] }));
    expect(r.items[0]).toMatchObject({
      ticketKey: "AI-2",
      status: "skipped",
      reason: "Blocked by AI-1: Ticket core (In progress)",
    });
  });

  it("GivenABlockerInAnotherProject_WhenDryRun_ThenSkippedAsNotRead", () => {
    const r = nextUp(input({ tickets: [ticket(2, { blockedBy: ["OPS-4"] })] }));
    expect(r.items[0]!.reason).toBe("Blocked by OPS-4 (not in this project's tickets)");
  });

  it("GivenAParkedMilestone_WhenDryRun_ThenSkippedWithTheMilestoneReason", () => {
    const r = nextUp(
      input({ tickets: [ticket(1)], milestoneHolds: new Map([["t1", "Milestone M6 is parked"]]) }),
    );
    expect(r.items[0]).toMatchObject({ status: "skipped", reason: "Milestone M6 is parked" });
  });

  it("GivenTouchesOverlapARunInFlight_WhenDryRun_ThenSkippedNamingTheBuildingTicket", () => {
    const building = ticket(1, { stage: "in_progress", touches: ["apps/web/**"] });
    const r = nextUp(
      input({
        tickets: [building, ticket(2, { touches: ["apps/web/src/x.ts"] })],
        activeRuns: [run("t1", { touches: ["apps/web/**"] })],
      }),
    );
    expect(r.items[0]).toMatchObject({
      ticketKey: "AI-2",
      status: "skipped",
      reason: "Its files overlap AI-1: Ticket 1, building now",
    });
  });

  it("GivenTwoReadyTicketsThatOverlap_WhenDryRun_ThenTheSecondWaitsOnTheFirst", () => {
    const r = nextUp(
      input({
        tickets: [ticket(1, { touches: ["docs/**"] }), ticket(2, { touches: ["docs/a.md"] })],
      }),
    );
    expect(statuses(r)).toEqual(["AI-1 starts_now", "AI-2 skipped"]);
    expect(r.items[1]!.reason).toBe("Its files overlap AI-1: Ticket 1, which would start first");
  });

  it("GivenAnOpenQuestion_WhenDryRun_ThenSkippedForTheDefinitionOfReady", () => {
    const r = nextUp(input({ tickets: [ticket(1)], openQuestions: new Map([["t1", 1]]) }));
    expect(r.items[0]!.reason).toBe("Definition of Ready not met: 1 open question(s) answered");
  });

  it("GivenNeedsYouAndAndysOwnWork_WhenDryRun_ThenEachSkippedWithWhy", () => {
    const r = nextUp(
      input({
        tickets: [
          ticket(1, { needsAttention: true }),
          ticket(2, { overrides: { assignee: "me" } }),
        ],
      }),
    );
    expect(r.items.map((i) => i.reason)).toEqual([
      "Waits on Andy (Needs-you)",
      "Assigned to Andy: he does it himself",
    ]);
  });

  it("GivenATicketForAnAwayLocalRunner_WhenDryRun_ThenSkippedAsWaitingForTheRunner", () => {
    const r = nextUp(input({ tickets: [ticket(1, { overrides: { executor: "local" } })] }));
    expect(r.items[0]!.reason).toBe("Waits for the local runner, which is away");
  });

  it("GivenTheBuildRunCapReached_WhenDryRun_ThenSkippedForAndy", () => {
    const builds = Array.from({ length: MAX_BUILD_RUNS_PER_TICKET }, (_, i) =>
      run("t1", {
        id: `b${i}`,
        status: "failed",
        executor: { repo: "o/r", ref: "main", externalId: `x${i}` },
      }),
    );
    const r = nextUp(input({ tickets: [ticket(1)], ticketRuns: new Map([["t1", builds]]) }));
    expect(r.items[0]!.reason).toMatch(/^Build ran \d+ times without a merged change/);
  });

  it("GivenPlanApprovalForAll_WhenDryRun_ThenTheItemSaysAPlanRunComesFirst", () => {
    const r = nextUp(input({ project: { ...project, planApproval: "all" }, tickets: [ticket(1)] }));
    expect(r.items[0]).toMatchObject({ status: "starts_now" });
    expect(r.items[0]!.reason).toMatch(/^Starts with a plan run/);
  });

  it.each([
    [
      { autoBuild: false },
      facts,
      "Nothing starts on its own: auto-build is off, so Andy starts each build",
    ],
    [{ buildEnabled: false }, facts, "Nothing starts on its own: builds are off for this project"],
    [{}, { ...facts, canDispatch: false }, "Nothing starts on its own: no executor is set up here"],
    [{ paused: true }, facts, "Dispatch is paused"],
    [
      {},
      { ...facts, globalActive: MAX_ACTIVE_RUNS_GLOBAL },
      "Dispatch is at the global cap (4 agent tasks at once)",
    ],
    [{}, { ...facts, quotaLevel: "pause" as const }, "Dispatch is idle: quota is at the reserve"],
  ])("GivenDispatchHeld_WhenDryRun_ThenNothingStartsAndTheLineSaysWhy %#", (over, f, line) => {
    const r = nextUp(input({ project: { ...project, ...over }, facts: f, tickets: [ticket(1)] }));
    expect(statuses(r)).toEqual(["AI-1 next"]);
    expect(r.idle).toBe(line);
  });

  it("GivenTheProjectsDialFull_WhenDryRun_ThenNothingStartsAtTheDial", () => {
    const busy = [run("t8", { id: "a" }), run("t9", { id: "b", touches: ["x/**"] })];
    const r = nextUp(input({ tickets: [ticket(1)], activeRuns: busy }));
    expect(r.idle).toBe("Dispatch is at the project's dial (2 agent tasks at once)");
  });

  it("GivenPrsWaitingAtTheCap_WhenDryRun_ThenTheLineNamesThePrCap", () => {
    const review = Array.from({ length: MAX_PRS_WAITING_PER_PROJECT }, (_, i) =>
      ticket(100 + i, { stage: "ready_for_review" }),
    );
    const ticketRuns = new Map(
      review.map((t) => [
        t.id,
        [
          run(t.id, {
            status: "succeeded",
            links: { pullRequest: `https://github.com/o/r/pull/${t.id.slice(1)}` },
          }),
        ],
      ]),
    );
    const r = nextUp(
      input({
        project: { ...project, runsAtOnce: 9 },
        tickets: [...review, ticket(1)],
        ticketRuns,
      }),
    );
    expect(r.idle).toBe("Dispatch is idle: 5 PRs wait for Andy");
  });

  it("GivenNoReadyTicket_WhenDryRun_ThenTheLineSaysNothingIsInReady", () => {
    expect(nextUp(input()).idle).toBe("Nothing more starts: no ticket is in Ready");
  });

  it("GivenEveryReadyTicketSkipped_WhenDryRun_ThenTheLinePointsAtTheSkips", () => {
    const r = nextUp(input({ tickets: [ticket(1, { needsAttention: true })] }));
    expect(r.idle).toBe("Nothing starts: no Ready ticket can start now (see why each is skipped)");
  });

  it("GivenMoreReadyTicketsThanTheCap_WhenDryRun_ThenCutShortAndSaysSo", () => {
    const tickets = Array.from({ length: DIGEST_NEXT_UP_MAX + 3 }, (_, i) => ticket(i + 1));
    const r = nextUp(input({ tickets }));
    expect(r.items).toHaveLength(DIGEST_NEXT_UP_MAX);
    expect(r.truncated).toBe(true);
    expect(nextUp(input({ tickets: tickets.slice(0, 2) })).truncated).toBe(false);
  });

  it("GivenFrozenInputs_WhenDryRun_ThenNothingIsChanged", () => {
    const tickets = Object.freeze([Object.freeze(ticket(1)), Object.freeze(ticket(2))]);
    const activeRuns = Object.freeze([Object.freeze(run("t9", { touches: ["z/**"] }))]);
    const before = JSON.stringify({ tickets, activeRuns });
    nextUp(input({ tickets, activeRuns }));
    expect(JSON.stringify({ tickets, activeRuns })).toBe(before);
  });
});

describe("readySkip", () => {
  it("GivenAChildOfAnEpicAssignedToAndy_WhenAsked_ThenAndysWork", () => {
    const epic = ticket(1, { type: "epic", overrides: { assignee: "me" } });
    const child = ticket(2, { parentId: "t1" });
    expect(readySkip(child, [epic, child], project, { kind: "actions" }, false)).toBe("andys_work");
  });

  it("GivenAPlainReadyTicket_WhenAsked_ThenNoSkip", () => {
    const t = ticket(1);
    expect(readySkip(t, [t], project, { kind: "actions" }, false)).toBeNull();
  });
});
