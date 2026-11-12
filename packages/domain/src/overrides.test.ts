import type { Ticket, TicketOverrides } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { effectiveOverrides, epicOf, inheritedOverrides } from "./overrides";
import { tierFor } from "./tiers";
import { isDispatchable, resolveWorker } from "./worker";

const own = (overrides: TicketOverrides) => ({ overrides });
const project = { defaultWorker: "agent" as const };

describe("epic overrides cascade (AI-116)", () => {
  it("GivenNoTicketTierAndAnEpicTier_WhenTheTierIsResolved_ThenTheEpicsTierIsUsed", () => {
    const child = { size: "S" as const, overrides: {} };
    expect(tierFor(child, own({ tier: "frontier" }))).toBe("frontier");
  });

  it("GivenBothSetATier_WhenResolved_ThenTheTicketsTierWins", () => {
    const child = { size: "S" as const, overrides: { tier: "cheap" as const } };
    expect(tierFor(child, own({ tier: "frontier" }))).toBe("cheap");
  });

  it("GivenNoEpic_WhenTheTierIsResolved_ThenItComesFromSize", () => {
    expect(tierFor({ size: "S", overrides: {} }, null)).toBe("fast");
  });

  it("GivenAnEpicAssignedToAndy_WhenAChildWithoutItsOwnAssigneeIsChecked_ThenItIsNotDispatchable", () => {
    const epic = own({ assignee: "me" });
    expect(resolveWorker(own({}), project, epic)).toBe("me");
    expect(isDispatchable(own({}), project, epic)).toBe(false);
  });

  it("GivenAnEpicAssignedToAndyAndAChildGivenToTheAgent_WhenChecked_ThenTheChildIsDispatchable", () => {
    expect(isDispatchable(own({ assignee: "agent" }), project, own({ assignee: "me" }))).toBe(true);
  });

  it("GivenEveryField_WhenMerged_ThenTicketValuesWinAndExecutorNeverCascades", () => {
    const child = own({ tier: "cheap", autonomy: "manual" });
    const epic = own({
      tier: "frontier",
      autonomy: "autonomous",
      targetEnv: "prod",
      assignee: "me",
      executor: "local",
    });

    expect(effectiveOverrides(child, epic)).toEqual({
      tier: "cheap",
      autonomy: "manual",
      targetEnv: "prod",
      assignee: "me",
    });
    expect(inheritedOverrides(child, epic)).toEqual(["assignee", "targetEnv"]);
  });

  it("GivenAParentThatIsNotAnEpic_WhenTheEpicIsLookedUp_ThenNone", () => {
    const tickets = [
      { id: "e", type: "epic" },
      { id: "f", type: "feature" },
    ] as Ticket[];
    expect(epicOf({ parentId: "e" }, tickets)?.id).toBe("e");
    expect(epicOf({ parentId: "f" }, tickets)).toBeNull();
    expect(epicOf({ parentId: null }, tickets)).toBeNull();
  });
});
