import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BREAKDOWN_LIMITS,
  EpicBreakdownDecision,
  EpicBreakdownProposal,
  type DraftedTicket,
} from "./epic-breakdown";

// The schema the plan-epic agent gets; EpicBreakdownProposal is the control plane's check.
const schema = JSON.parse(
  readFileSync(
    new URL("../../../../platform/procedures/plan-epic.schema.json", import.meta.url),
    "utf8",
  ),
);
const item = schema.properties.tickets.items;

const ticket = (over: Partial<DraftedTicket> = {}): DraftedTicket => ({
  title: "Log a run",
  type: "feature",
  size: "S",
  sizeReason: "One form.",
  body: "A form that saves a run.",
  acceptanceCriteria: ["When Andy saves a run, the system shall list it."],
  touches: ["apps/web/**"],
  blockedBy: [],
  ...over,
});
const valid = { summary: "Two tickets.", tickets: [ticket(), ticket({ blockedBy: [0] })] };

describe("EpicBreakdownProposal", () => {
  it("GivenTheAgentSchema_WhenComparedWithTheCheck_ThenTheCapsAndFieldsMatch", () => {
    expect(schema.properties.summary.maxLength).toBe(BREAKDOWN_LIMITS.summary);
    expect(schema.properties.tickets.maxItems).toBe(BREAKDOWN_LIMITS.tickets);
    expect(item.properties.title.maxLength).toBe(BREAKDOWN_LIMITS.title);
    expect(item.properties.body.maxLength).toBe(BREAKDOWN_LIMITS.body);
    expect(item.properties.sizeReason.maxLength).toBe(BREAKDOWN_LIMITS.sizeReason);
    expect(item.properties.acceptanceCriteria.maxItems).toBe(BREAKDOWN_LIMITS.criteria);
    expect(item.properties.acceptanceCriteria.items.maxLength).toBe(BREAKDOWN_LIMITS.criterion);
    expect(item.properties.touches.maxItems).toBe(BREAKDOWN_LIMITS.touches);
    expect(item.properties.touches.items.maxLength).toBe(BREAKDOWN_LIMITS.touch);
    expect(item.properties.blockedBy.items.maximum).toBe(BREAKDOWN_LIMITS.tickets - 1);
    expect(item.properties.type.enum).toEqual(["feature", "chore", "bug", "spike"]);
    expect(item.required.sort()).toEqual(Object.keys(ticket()).sort());
  });

  it("GivenAValidProposal_WhenParsed_ThenAccepted", () => {
    expect(EpicBreakdownProposal.safeParse(valid).success).toBe(true);
  });

  it("GivenMoreTicketsThanTheCap_WhenParsed_ThenRefused", () => {
    const tickets = Array.from({ length: BREAKDOWN_LIMITS.tickets + 1 }, () => ticket());
    expect(EpicBreakdownProposal.safeParse({ summary: "x", tickets }).success).toBe(false);
  });

  it("GivenAnEpicDrafted_WhenParsed_ThenRefused", () => {
    const tickets = [ticket({ type: "epic" as DraftedTicket["type"] })];
    expect(EpicBreakdownProposal.safeParse({ summary: "x", tickets }).success).toBe(false);
  });

  it("GivenTicketsBlockingEachOtherInACycle_WhenParsed_ThenRefused", () => {
    const tickets = [ticket({ blockedBy: [1] }), ticket({ blockedBy: [0] })];
    const parsed = EpicBreakdownProposal.safeParse({ summary: "x", tickets });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.message)).toContain(
      "children block each other in a cycle",
    );
  });

  it("GivenABlockerOutsideTheList_WhenParsed_ThenRefused", () => {
    const tickets = [ticket({ blockedBy: [3] })];
    expect(EpicBreakdownProposal.safeParse({ summary: "x", tickets }).success).toBe(false);
  });

  it("GivenAnExtraField_WhenParsed_ThenRefused", () => {
    const parsed = EpicBreakdownProposal.safeParse({ ...valid, createTickets: true });
    expect(parsed.success).toBe(false);
  });
});

describe("EpicBreakdownDecision", () => {
  it("GivenASendBackWithoutANote_WhenParsed_ThenRefused", () => {
    expect(EpicBreakdownDecision.safeParse({ decision: "rejected", reason: " " }).success).toBe(
      false,
    );
    expect(EpicBreakdownDecision.safeParse({ decision: "approved" }).success).toBe(true);
  });
});
