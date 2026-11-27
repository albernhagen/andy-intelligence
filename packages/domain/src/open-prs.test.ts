import {
  buildRun,
  DIGEST_OPEN_PRS_MAX,
  MergeWaitReason,
  type Run,
  type Ticket,
  type TicketEvent,
} from "@andy/contracts";
import { describe, expect, it } from "vitest";
import type { MergeHold } from "./merge-holds";
import { MERGE_WAIT_TEXT, openPrs, type OpenPrsInput } from "./open-prs";

const AT = "2026-11-27T12:00:00.000Z";
const url = (n: number) => `https://github.com/o/r/pull/${n}`;

const ticket = (n: number, over: Partial<Ticket> = {}): Ticket =>
  ({
    id: `t${n}`,
    key: `AI-${n}`,
    title: `Ticket ${n}`,
    stage: "ready_for_review",
    rank: String(n).padStart(10, "0"),
    archived: false,
    ...over,
  }) as Ticket;

const linked = (ticketId: string, n: number, state: string): TicketEvent => ({
  id: `${ticketId}-${n}-${state}`,
  ticketId,
  kind: "pr_linked",
  actor: "system",
  runId: null,
  body: null,
  data: { number: n, url: url(n), state },
  createdAt: AT,
});

const run = (ticketId: string, n: number, over: Partial<Run> = {}): Run => ({
  ...buildRun(
    {
      projectId: "ai",
      ticketId,
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: null,
    },
    `r${n}`,
    new Date(AT),
  ),
  status: "succeeded",
  links: { pullRequest: url(n) },
  ...over,
});

/** One ticket with one open PR and the given build run. */
const one = (r: Partial<Run> | null, holds: MergeHold[] = []): OpenPrsInput => ({
  tickets: [ticket(1)],
  ticketEvents: new Map([["t1", [linked("t1", 7, "open")]]]),
  ticketRuns: new Map([["t1", r ? [run("t1", 7, r)] : []]]),
  mergeHolds: holds,
});

const lines = (input: OpenPrsInput) => openPrs(input).openPrs[0]!.lines;

describe("openPrs", () => {
  it("GivenAKeptPathWait_WhenListed_ThenOneSentenceSaysItWaitsForAndy", () => {
    const pr = openPrs(
      one({ mergeVerdict: "wait", verdictReasons: ["kept_path"], mergeMode: "low-risk" }),
    ).openPrs[0]!;
    expect(pr).toMatchObject({
      ticketKey: "AI-1",
      prNumber: 7,
      prUrl: url(7),
      state: "waiting",
      mergeMode: "low-risk",
      reasons: ["kept_path"],
    });
    expect(pr.lines).toEqual([
      "Waits for Andy: it changes a path on his kept list, which only he merges",
    ]);
  });

  it("GivenTheGateNotClean_WhenListed_ThenEachGateReasonIsItsOwnSentence", () => {
    expect(
      lines(
        one({
          mergeVerdict: "wait",
          verdictReasons: ["gate_not_clean"],
          gateReasons: ["checks_failed", "protected_path"],
          protectedFiles: [".github/workflows/ci.yml"],
        }),
      ),
    ).toEqual([
      "A required check failed (the gate records that one failed, not which: see the PR's checks)",
      "It changes a protected path, so the gate vetoes it: .github/workflows/ci.yml",
    ]);
  });

  it("GivenMainRedAndAHoldOnTheRepo_WhenListed_ThenTheFailingChecksAreNamed", () => {
    const hold: MergeHold = {
      repo: "O/R",
      since: AT,
      checks: ["ci / test"],
      waiting: 2,
      raised: false,
    };
    expect(lines(one({ mergeVerdict: "wait", verdictReasons: ["main_red"] }, [hold]))).toEqual([
      "Held because main is red (failing: ci / test); it merges once main is green",
    ]);
  });

  it("GivenMainRedButNoHoldNow_WhenListed_ThenSaysMainWasRedWhenJudged", () => {
    expect(lines(one({ mergeVerdict: "wait", verdictReasons: ["main_red"] }))).toEqual([
      "Held because main was red when the gate last judged it",
    ]);
  });

  it("GivenEveryMergeWaitReason_WhenListed_ThenEachHasAPlainSentence", () => {
    for (const reason of MergeWaitReason.options) {
      const got = lines(one({ mergeVerdict: "wait", verdictReasons: [reason] }));
      expect(got).toHaveLength(1);
      if (reason !== "main_red") expect(got[0]).toBe(MERGE_WAIT_TEXT[reason]);
    }
  });

  it("GivenAVerdictOfMerge_WhenListed_ThenMergingThroughTheQueue", () => {
    const pr = openPrs(one({ mergeVerdict: "merge" })).openPrs[0]!;
    expect(pr).toMatchObject({ state: "merging", reasons: [] });
    expect(pr.lines).toEqual(["Clean: the merge gate merges it through the merge queue"]);
  });

  it("GivenNoAgentTaskOpenedIt_WhenListed_ThenNotJudgedAndSaysWhy", () => {
    const pr = openPrs(one(null)).openPrs[0]!;
    expect(pr.state).toBe("not_judged");
    expect(pr.lines[0]).toMatch(/^Not judged here: no build agent task opened it/);
  });

  it("GivenAnAgentPrNotYetJudged_WhenListed_ThenSaysTheGateHasntJudgedIt", () => {
    expect(lines(one({ mergeVerdict: null }))).toEqual([
      "The merge gate hasn't judged its latest head yet",
    ]);
  });

  it("GivenClosedMergedAndDoneTicketsPrs_WhenListed_ThenOnlyOpenOnesOnOpenTickets", () => {
    const input: OpenPrsInput = {
      tickets: [ticket(1), ticket(2, { stage: "done" }), ticket(3, { stage: "in_progress" })],
      ticketEvents: new Map([
        ["t1", [linked("t1", 1, "open"), linked("t1", 1, "closed"), linked("t1", 4, "open")]],
        ["t2", [linked("t2", 2, "open")]],
        ["t3", [linked("t3", 3, "open")]],
      ]),
      ticketRuns: new Map(),
      mergeHolds: [],
    };
    expect(openPrs(input).openPrs.map((p) => p.prNumber)).toEqual([4, 3]);
  });

  it("GivenMoreOpenPrsThanTheCap_WhenListed_ThenCutShortInBoardOrder", () => {
    const tickets = Array.from({ length: DIGEST_OPEN_PRS_MAX + 2 }, (_, i) => ticket(i + 1));
    const r = openPrs({
      tickets: [...tickets].reverse(),
      ticketEvents: new Map(tickets.map((t, i) => [t.id, [linked(t.id, i + 1, "open")]])),
      ticketRuns: new Map(),
      mergeHolds: [],
    });
    expect(r.openPrs).toHaveLength(DIGEST_OPEN_PRS_MAX);
    expect(r.openPrs[0]!.ticketKey).toBe("AI-1");
    expect(r.truncated).toBe(true);
  });

  it("GivenATicketInReviewWhoseHistoryWasntRead_WhenListed_ThenCutShort", () => {
    const r = openPrs({ ...one(null), tickets: [ticket(1), ticket(2)] });
    expect(r.openPrs).toHaveLength(1);
    expect(r.truncated).toBe(true);
    expect(openPrs(one(null)).truncated).toBe(false);
  });
});
