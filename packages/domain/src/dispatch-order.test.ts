import type { DispatchDecision, LastDispatch } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_RUNS_GLOBAL } from "./dispatch-caps";
import { dispatchOrder } from "./dispatch-order";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 12, 0, minute)).toISOString();
const project = (id: string, decision: DispatchDecision | null, minute = 0) => ({
  id,
  lastDispatch: decision ? { decision, at: at(minute) } : null,
});

describe("dispatchOrder", () => {
  it("GivenAProjectIdleOnTheGlobalCap_WhenAnotherProjectFreesASlot_ThenTheWaiterComesBeforeTheFreeingProject", () => {
    const order = dispatchOrder([project("A", "started", 1), project("B", "global_cap", 5)], "A");
    expect(order).toEqual(["B", "A"]);
  });

  it("GivenSeveralWaiters_WhenOrdered_ThenTheLongestWaitingGoesFirst", () => {
    const order = dispatchOrder(
      [project("A", "global_cap", 1), project("B", "global_cap", 9), project("C", "global_cap", 3)],
      "A",
    );
    expect(order).toEqual(["C", "B", "A"]);
  });

  it("GivenProjectsNotOnTheGlobalCap_WhenOrdered_ThenTheyComeAfterTheWaitersOldestDecisionFirst", () => {
    const order = dispatchOrder(
      [
        project("A", "started", 0),
        project("B", "nothing_ready", 8),
        project("C", null),
        project("D", "global_cap", 9),
        project("E", "project_cap", 2),
      ],
      "A",
    );
    expect(order).toEqual(["D", "C", "E", "B", "A"]);
  });

  it("GivenTheFreeingProjectIsTheOnlyOne_WhenOrdered_ThenItIsWokenAlone", () => {
    expect(dispatchOrder([project("A", "global_cap", 1)], "A")).toEqual(["A"]);
  });

  it("GivenTheFreeingProjectIsMissingFromTheList_WhenOrdered_ThenItIsStillWokenLast", () => {
    expect(dispatchOrder([project("B", "nothing_ready", 1)], "A")).toEqual(["B", "A"]);
  });

  /**
   * Two or three projects with endless Ready work share the global cap. Each wake-up starts runs
   * while a slot is free and records its decision as `BuildDispatcher.record` does: a project that
   * started a run gets a fresh `at`; one that only found the cap full keeps its first `at`.
   */
  function simulate(ids: string[], settles: number) {
    let clock = 0;
    const last = new Map<string, LastDispatch | null>(ids.map((id) => [id, null]));
    const inFlight: string[] = []; // oldest first: runs end in the order they started
    const starts: string[] = [];
    const wake = (id: string) => {
      let started = false;
      while (inFlight.length < MAX_ACTIVE_RUNS_GLOBAL) {
        inFlight.push(id);
        starts.push(id);
        started = true;
      }
      const before = last.get(id);
      if (started || before?.decision !== "global_cap") {
        last.set(id, { decision: "global_cap", at: at(clock++) });
      }
    };
    for (const id of ids) wake(id);
    for (let i = 0; i < settles; i++) {
      const freedBy = inFlight.shift()!;
      const projects = ids.map((id) => ({ id, lastDispatch: last.get(id) ?? null }));
      for (const id of dispatchOrder(projects, freedBy)) wake(id);
    }
    return starts;
  }

  it("GivenTwoProjectsWithReadyWork_WhenSlotsFreeOneByOne_ThenEachFreedSlotGoesToTheOtherProject", () => {
    const starts = simulate(["A", "B"], 16);
    // A filled the cap first; from then on every freed slot went to the project that didn't free it.
    expect(starts.slice(0, MAX_ACTIVE_RUNS_GLOBAL)).toEqual(
      Array(MAX_ACTIVE_RUNS_GLOBAL).fill("A"),
    );
    const after = starts.slice(MAX_ACTIVE_RUNS_GLOBAL);
    expect(after.filter((s) => s === "A")).toHaveLength(8);
    expect(after.filter((s) => s === "B")).toHaveLength(8);
    expect(new Set(after.slice(0, MAX_ACTIVE_RUNS_GLOBAL))).toEqual(new Set(["B"]));
  });

  it("GivenThreeProjectsWaiting_WhenSlotsFree_ThenTheyTakeTurnsLongestWaitingFirst", () => {
    const starts = simulate(["A", "B", "C"], 12).slice(MAX_ACTIVE_RUNS_GLOBAL);
    // A frees the first slots: B (waiting since before C), then C. Once each holds a run, the
    // project that waited longest takes each freed slot: a round robin, none left out.
    expect(starts.join("")).toBe("BCBCABCABCAB");
  });
});
