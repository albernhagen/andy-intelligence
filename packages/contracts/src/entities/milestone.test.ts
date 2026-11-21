import { describe, expect, it } from "vitest";
import type { Project, Ticket } from ".";
import { applyTicketChange, buildTicket } from "../ports/work-tracker-support";
import { milestoneTargetProblem } from "./milestone";

/** AI-302: M4.33: only a top-level epic holds a milestone (ADR-0131). */

const AT = new Date("2026-11-21T12:00:00.000Z");
const project = { id: "ai", key: "AI" } as Project;
const epic = (over: Partial<Ticket> = {}): Ticket => ({
  ...buildTicket(project, 1, { title: "Roadmap", type: "epic" }, "system", AT).ticket,
  milestoneId: "m1",
  ...over,
});

describe("milestoneTargetProblem", () => {
  it("GivenATopLevelEpic_WhenChecked_ThenAllowed", () => {
    expect(milestoneTargetProblem({ key: "AI-1", type: "epic", parentId: null })).toBeNull();
  });

  it("GivenAChildEpicOrANonEpicTicket_WhenChecked_ThenRefusedWithTheReason", () => {
    expect(milestoneTargetProblem({ key: "AI-2", type: "epic", parentId: "e1" })).toMatch(
      /AI-2 is a child epic/,
    );
    expect(milestoneTargetProblem({ key: "AI-3", type: "feature", parentId: null })).toMatch(
      /AI-3 is a feature/,
    );
    expect(milestoneTargetProblem({ key: "AI-4", type: null, parentId: null })).toMatch(
      /AI-4 is untyped/,
    );
  });
});

describe("applyTicketChange with a milestone", () => {
  it("GivenANewTicket_WhenBuilt_ThenItHasNoMilestone", () => {
    expect(buildTicket(project, 2, { title: "Idea" }, "system", AT).ticket.milestoneId).toBeNull();
  });

  it("GivenATopLevelEpicWithAMilestone_WhenItsTitleChanges_ThenSavedWithTheMilestone", () => {
    const { ticket } = applyTicketChange(epic(), { fields: { title: "Renamed" } }, "system", AT);
    expect(ticket).toMatchObject({ title: "Renamed", milestoneId: "m1" });
  });

  it("GivenAnEpicWithAMilestone_WhenGivenAParentOrAnotherType_ThenRefused", () => {
    expect(() => applyTicketChange(epic(), { fields: { parentId: "e0" } }, "system", AT)).toThrow(
      /child epic/,
    );
    expect(() => applyTicketChange(epic(), { fields: { type: "feature" } }, "system", AT)).toThrow(
      /is a feature/,
    );
  });

  it("GivenAStaleMilestoneOnAFeature_WhenAnyChangeIsWritten_ThenRefusedAsAConflict", () => {
    const stale = epic({ type: "feature" });
    expect(() => applyTicketChange(stale, { fields: { title: "x" } }, "system", AT)).toThrow(
      expect.objectContaining({ code: "conflict" }),
    );
  });
});
