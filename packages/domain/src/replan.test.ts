import { InMemoryWorkTracker, Run, type TicketEvent } from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import type { PlanState } from "./plans";
import { blockersDoneAt, doneAt, replanNote, staleBlocker } from "./replan";
import { TIER_ROUTES } from "./tiers";

const plan = Run.parse({
  id: "p1",
  projectId: "ai",
  ticketId: "t1",
  step: "plan",
  route: TIER_ROUTES.strong,
  tier: "strong",
  status: "succeeded",
  startedAt: "2026-11-06T10:00:00.000Z",
  endedAt: "2026-11-06T11:00:00.000Z",
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  costIsEstimate: true,
  quotaSnapshot: null,
  links: {},
  outcome: null,
  wouldAutoMerge: null,
  createdAt: "2026-11-06T10:00:00.000Z",
});
const BEFORE = "2026-11-06T09:30:00.000Z";
/** Between the plan run's start (10:00) and its end (11:00). */
const DURING = "2026-11-06T10:30:00.000Z";
const AFTER = "2026-11-06T11:30:00.000Z";
const LATER = "2026-11-06T12:00:00.000Z";

const stageEvent = (to: string, createdAt: string): TicketEvent => ({
  id: createdAt,
  ticketId: "b1",
  kind: "stage_changed",
  actor: "system",
  runId: null,
  body: null,
  data: { from: "ready_for_review", to, forced: false },
  createdAt,
});

describe("doneAt", () => {
  it("GivenATicketDoneTwice_WhenRead_ThenItIsTheLastDoneTime", () => {
    const events = [
      stageEvent("done", BEFORE),
      stageEvent("in_progress", AFTER),
      stageEvent("done", LATER),
    ];
    expect(doneAt(events)).toBe(LATER);
  });

  it("GivenATicketNeverDone_WhenRead_ThenItIsNull", () => {
    expect(doneAt([stageEvent("ready", BEFORE)])).toBeNull();
  });
});

describe("staleBlocker", () => {
  const states: PlanState[] = [
    { kind: "approved", run: plan },
    { kind: "awaiting", run: plan },
    { kind: "stale", run: plan },
  ];

  it.each(states)(
    "GivenA$kind PlanOlderThanABlockersDone_WhenChecked_ThenThatBlockerIsNamed",
    (state) => {
      expect(staleBlocker(state, new Map([["AI-1", AFTER]]))).toBe("AI-1");
    },
  );

  it("GivenABlockerDoneWhileThePlanRan_WhenChecked_ThenThePlanIsStale", () => {
    expect(staleBlocker({ kind: "approved", run: plan }, new Map([["AI-1", DURING]]))).toBe("AI-1");
  });

  it("GivenSeveralBlockersDoneAfterThePlan_WhenChecked_ThenTheLatestIsNamed", () => {
    const done = new Map([
      ["AI-1", LATER],
      ["AI-2", AFTER],
      ["AI-3", BEFORE],
    ]);
    expect(staleBlocker({ kind: "approved", run: plan }, done)).toBe("AI-1");
  });

  it("GivenEveryBlockerDoneBeforeThePlanOrUnknown_WhenChecked_ThenNothingIsStale", () => {
    const done = new Map<string, string | null>([
      ["AI-1", BEFORE],
      ["AI-2", null],
    ]);
    expect(staleBlocker({ kind: "approved", run: plan }, done)).toBeNull();
  });

  it("GivenNoBlockers_WhenChecked_ThenNothingIsStale", () => {
    expect(staleBlocker({ kind: "approved", run: plan }, new Map())).toBeNull();
  });

  it.each<PlanState>([
    { kind: "none" },
    { kind: "planning", run: plan },
    { kind: "rejected", run: plan },
  ])("GivenA$kind Plan_WhenABlockerIsDoneAfterIt_ThenNothingIsStale", (state) => {
    expect(staleBlocker(state, new Map([["AI-1", AFTER]]))).toBeNull();
  });
});

describe("replanNote", () => {
  it("GivenABlockerKey_WhenWritten_ThenItNamesTheBlocker", () => {
    expect(replanNote("AI-7")).toBe("Plan re-run: AI-7 merged after the plan.");
  });
});

describe("blockersDoneAt", () => {
  it("GivenBlockersByKeyAndById_WhenRead_ThenEachDoneTimeIsKeyedByTicketKey", async () => {
    let ms = Date.parse("2026-11-06T12:00:00.000Z");
    const tracker = new InMemoryWorkTracker(() => new Date((ms += 1000)));
    await tracker.createProject({ name: "AI", key: "AI", repos: ["a/b"] });
    const ticket = (title: string) =>
      tracker.createTicket(
        "ai",
        { type: "feature", title, body: "b", acceptanceCriteria: [] },
        "andy",
      );
    const done = await ticket("Done");
    const open = await ticket("Open");
    const moved = await tracker.updateTicket(
      "ai",
      done.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );
    const result = await blockersDoneAt(tracker, {
      projectId: "ai",
      blockedBy: [done.key, open.id, "XY-9"],
    });
    expect(result).toEqual(
      new Map([
        [done.key, moved.updatedAt],
        [open.key, null],
      ]),
    );
  });

  it("GivenAFailingRead_WhenRead_ThenItThrowsRatherThanReportNothing", async () => {
    const tracker = new InMemoryWorkTracker();
    vi.spyOn(tracker, "listTickets").mockRejectedValue(new Error("unavailable"));
    await expect(blockersDoneAt(tracker, { projectId: "ai", blockedBy: ["AI-1"] })).rejects.toThrow(
      "unavailable",
    );
  });

  it("GivenNoBlockers_WhenRead_ThenNothingIsLoaded", async () => {
    const tracker = new InMemoryWorkTracker();
    expect(await blockersDoneAt(tracker, { projectId: "ai", blockedBy: [] })).toEqual(new Map());
  });
});
