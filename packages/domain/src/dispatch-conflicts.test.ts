import { describe, expect, it } from "vitest";
import type { InFlightRun, Run } from "@andy/contracts";
import {
  adrLabel,
  blockingRun,
  editingRuns,
  globMatches,
  highestAdrInIndex,
  overlappingKey,
  overlaps,
  runTouches,
} from "./dispatch-conflicts";

const run = (over: Partial<Run>): Run =>
  ({
    id: "r1",
    ticketId: "t1",
    step: "build",
    status: "running",
    deadline: null,
    createdAt: "2026-11-09T10:00:00.000Z",
    touches: [],
    ...over,
  }) as Run;

describe("overlaps", () => {
  it.each([
    [["packages/store/src/run-store.ts"], ["packages/store/src/run-store.ts"], true],
    [["packages/store/**"], ["packages/store/src/run-store.ts"], true],
    [["packages/store"], ["packages/store/src/run-store.ts"], true],
    [["packages/store/"], ["packages/store/src/x.ts"], true],
    [["./packages/store/x.ts"], ["packages/store/x.ts"], true],
    [["packages/store/**"], ["packages/domain/**"], false],
    [["packages/store"], ["packages/storefront/x.ts"], false],
    [["apps/web/src/components/InFlightPanel*"], ["apps/web/src/components/Board.tsx"], false],
    [
      ["apps/web/src/components/InFlightPanel*"],
      ["apps/web/src/components/InFlightPanel.tsx"],
      true,
    ],
    [["packages/*/src/index.ts"], ["packages/domain/src/index.ts"], true],
    [["apps/web/**/*.tsx"], ["apps/web/src"], true],
    [["packages/contracts/src/entities/run*"], ["packages/contracts/src/entities/index.ts"], false],
    [["packages/**"], ["packages/domain/*.ts"], true],
    [["apps/**"], ["packages/**"], false],
    [["**/*.md"], ["packages/x.ts"], true],
    [["a.ts", "b.ts"], ["c.ts", "b.ts"], true],
  ])("GivenTouches_%j_And_%j_WhenCompared_ThenOverlapIs_%s", (a, b, expected) => {
    expect(overlaps(a, b)).toBe(expected);
    expect(overlaps(b, a)).toBe(expected);
  });

  it("GivenAnEmptyTouchesList_WhenCompared_ThenItOverlapsEverything", () => {
    expect(overlaps([], ["docs/x.md"])).toBe(true);
    expect(overlaps(["docs/x.md"], [])).toBe(true);
  });
});

describe("untrusted touches (safe subset, no regular expressions)", () => {
  it.each([
    ["more stars than the limit", "*a*a*a*a*a*a*a*a*a*b"],
    ["a question mark", "src/?.ts"],
    ["a character class", "src/[ab].ts"],
    ["braces", "src/{a,b}.ts"],
    ["a space", "src/a b.ts"],
    ["too long", `src/${"a".repeat(300)}`],
    ["too deep", Array(40).fill("d").join("/")],
  ])("GivenAGlobWith_%s_WhenCompared_ThenTheListIsUnknownAndOverlaps", (_, glob) => {
    expect(overlaps([glob], ["elsewhere/x.ts"])).toBe(true);
  });

  it("GivenMoreEntriesThanTheCap_WhenCompared_ThenTheListIsUnknown", () => {
    expect(
      overlaps(
        Array.from({ length: 101 }, (_, i) => `a/${i}.ts`),
        ["b/x.ts"],
      ),
    ).toBe(true);
  });

  it("GivenAHostileGlobAtTheLimits_WhenMatchedAgainstALongPath_ThenItAnswersFast", () => {
    const glob = "**/*a*a*a*a*a*a*a*b";
    const path = `x/${"a".repeat(290)}`;
    const started = performance.now();
    expect(globMatches(glob, path)).toBe(false);
    overlaps([glob, glob, glob], [path, path, path]);
    expect(globMatches(`**/**/**/**/**/**/**/**/**/**/x`, Array(31).fill("d").join("/"))).toBe(
      false,
    );
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("GivenSegmentGlobs_WhenMatched_ThenStarStaysInASegmentAndDoubleStarCrossesThem", () => {
    expect(globMatches("a/*.ts", "a/b.ts")).toBe(true);
    expect(globMatches("a/*.ts", "a/b/c.ts")).toBe(false);
    expect(globMatches("a/**/c.ts", "a/c.ts")).toBe(true);
    expect(globMatches("a/**/c.ts", "a/b/b/c.ts")).toBe(true);
    expect(globMatches("a/b*d*.ts", "a/bxdy.ts")).toBe(true);
  });
});

describe("blockingRun", () => {
  const ticket = { id: "t9", touches: ["packages/domain/**"] };

  it("GivenNothingInFlight_WhenATicketHasNoTouches_ThenNothingBlocksIt", () => {
    expect(blockingRun({ id: "t9", touches: [] }, [])).toBeNull();
  });

  it("GivenARunInFlight_WhenATicketHasNoTouches_ThenTheRunBlocksIt", () => {
    const r = run({ touches: ["docs/**"] });
    expect(blockingRun({ id: "t9", touches: [] }, [r])).toBe(r);
  });

  it("GivenOverlappingRuns_WhenAsked_ThenTheOldestBlocks", () => {
    const newer = run({
      id: "r2",
      createdAt: "2026-11-09T11:00:00.000Z",
      touches: ["packages/**"],
    });
    const older = run({ id: "r1", touches: ["packages/domain/src/x.ts"] });
    expect(blockingRun(ticket, [newer, older])?.id).toBe("r1");
  });

  it("GivenOnlyDisjointRunsAndTheTicketsOwn_WhenAsked_ThenNothingBlocks", () => {
    const disjoint = run({ touches: ["apps/web/**"] });
    const own = run({ id: "r3", ticketId: "t9", touches: ["packages/domain/**"] });
    expect(blockingRun(ticket, [disjoint, own])).toBeNull();
  });

  it("GivenARunWithUnknownTouches_WhenAsked_ThenItBlocks", () => {
    expect(blockingRun(ticket, [run({ touches: [] })])).not.toBeNull();
  });
});

describe("editingRuns", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");

  it("GivenRunsOfEveryKind_WhenFiltered_ThenOnlyLiveBuildRunsCount", () => {
    const live = run({ id: "build" });
    const runs = [
      live,
      run({ id: "plan", step: "plan" }),
      run({ id: "done", status: "succeeded" }),
      run({ id: "late", deadline: "2026-11-09T11:00:00.000Z" }),
    ];
    expect(editingRuns(runs, now).map((r) => r.id)).toEqual(["build"]);
  });
});

describe("runTouches", () => {
  it("GivenTicketTouchesAndPlanFiles_WhenCombined_ThenTheUnionWithoutRepeats", () => {
    expect(runTouches(["a/**", "b.ts"], ["b.ts", "c.ts"])).toEqual(["a/**", "b.ts", "c.ts"]);
  });

  it("GivenNoTouchesAndNoPlan_WhenCombined_ThenEmptyStaysUnknown", () => {
    expect(runTouches([])).toEqual([]);
  });
});

describe("ADR numbers", () => {
  const index = [
    "| ADR | Decision | Status |",
    "| --- | --- | --- |",
    "| [0079](0079-dispatch-caps.md) | Dispatch caps | accepted |",
    "| [0082](0082-worker-role.md) | Worker role | accepted |",
    "See [0099](0099-x.md) in prose: not a row.",
  ].join("\n");

  it("GivenAnIndex_WhenRead_ThenTheHighestRowNumber", () => {
    expect(highestAdrInIndex(index)).toBe(82);
    expect(highestAdrInIndex("no rows")).toBeNull();
  });

  it("GivenANumber_WhenLabelled_ThenFourDigits", () => {
    expect(adrLabel(83)).toBe("ADR-0083");
  });
});

describe("overlappingKey", () => {
  const view = (over: Partial<InFlightRun>): InFlightRun => ({
    runId: "r1",
    ticketKey: "AI-12",
    ticketTitle: "x",
    step: "build",
    status: "running",
    branch: null,
    pullRequest: null,
    startedAt: null,
    touches: ["packages/domain/**"],
    reservedAdr: null,
    ...over,
  });

  it("GivenAnOverlappingBuildInTheView_WhenAsked_ThenItsTicketKey", () => {
    const ticket = { key: "AI-13", touches: ["packages/domain/src/x.ts"] };
    expect(overlappingKey(ticket, [view({ step: "plan", ticketKey: "AI-1" }), view({})])).toBe(
      "AI-12",
    );
  });

  it("GivenOnlyTheTicketsOwnRunOrDisjointOnes_WhenAsked_ThenNull", () => {
    const ticket = { key: "AI-12", touches: ["packages/domain/**"] };
    expect(overlappingKey(ticket, [view({})])).toBeNull();
    expect(overlappingKey({ key: "AI-13", touches: ["apps/**"] }, [view({})])).toBeNull();
  });
});
