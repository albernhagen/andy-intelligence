import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { nextMove } from "@/components/MoveControls";
import { readyStory, renderApp } from "@/test/harness";

/**
 * AI-336: the ticket panel leads with the decision (the next move, open questions, the PR);
 * the rail is Details, then How it runs (collapsed, naming its values); an epic leads with its
 * outcome, tickets and milestone.
 */

const AT = "2026-11-21T00:00:00.000Z";

async function seeded(fields: Record<string, unknown> = readyStory) {
  const harness = renderApp();
  await harness.tracker.createProject({ name: "AI", key: "AI" });
  const ticket = await harness.service.create("ai", { title: "Board", ...fields }, "andy");
  const open = async (key = ticket.key) => {
    await harness.router.navigate({ to: `/p/ai/t/${key}` });
    return screen.findByRole("dialog", { name: new RegExp(`^${key}: `) });
  };
  return { ...harness, ticket, open };
}

/** Filled buttons: the primary variant's class (design.md: one per screen). */
const primaries = (root: HTMLElement) => [...root.querySelectorAll("button.bg-primary")];

/** True when `a` comes before `b` in the document. */
const before = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("ticket panel layout", () => {
  it("GivenEachStage_WhenAskedForTheNextMove_ThenItIsTheOneStepForwardOrReopen", () => {
    expect(nextMove("backlog")).toBe("ready");
    expect(nextMove("ready")).toBe("in_progress");
    expect(nextMove("in_progress")).toBe("ready_for_review");
    expect(nextMove("ready_for_review")).toBe("done");
    expect(nextMove("done")).toBeNull();
    expect(nextMove("cancelled")).toBe("backlog");
  });

  it("GivenABacklogTicket_WhenThePanelOpens_ThenTheNextMoveIsTheOnlyPrimaryButtonAndLeadsThePanel", async () => {
    const { open } = await seeded();
    const panel = await open();
    const next = await within(panel).findByRole("region", { name: "Next" });

    const move = within(next).getByRole("button", { name: "Move to Ready" });
    expect(primaries(panel)).toEqual([move]);
    expect(before(next, within(panel).getByRole("heading", { name: "AI-1: Board" }))).toBe(true);
  });

  it("GivenAReadyTicket_WhenMoveIsOpened_ThenTheOtherMovesUpNextAndForceAreThereAsOutline", async () => {
    const { open, service, ticket, user } = await seeded();
    await service.move("ai", ticket.id, "ready", "andy");
    const panel = await open();

    expect(await within(panel).findByRole("button", { name: "Move to In progress" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Move to Backlog" })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Move…" }));

    expect(within(panel).getByRole("button", { name: "Move to Backlog" })).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Force move…" }));
    expect(primaries(panel)).toHaveLength(1);

    // Collapsing Move… closes the force form too; reopening starts without it.
    await user.click(within(panel).getByRole("button", { name: "Move…" }));
    expect(within(panel).queryByLabelText("Force to")).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Move…" }));
    expect(within(panel).queryByLabelText("Force to")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Force move…" })).toBeTruthy();
  });

  it("GivenAForceFormOpen_WhenAndySwitchesTicket_ThenTheNextTicketStartsWithMoveCollapsed", async () => {
    const { open, service, user } = await seeded();
    await service.create("ai", { title: "Other" }, "andy");
    let panel = await open();
    await user.click(within(panel).getByRole("button", { name: "Move…" }));
    await user.click(within(panel).getByRole("button", { name: "Force move…" }));
    await user.selectOptions(within(panel).getByLabelText("Force to"), "Done");

    panel = await open("AI-2");

    expect(within(panel).getByRole("button", { name: "Move…" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(within(panel).queryByLabelText("Force to")).toBeNull();
  });

  it("GivenAnOpenQuestion_WhenThePanelOpens_ThenItShowsInNextAboveTheTitle", async () => {
    const { open, service, ticket } = await seeded();
    await service.ask("ai", ticket.id, { text: "Which lane?" }, "agent");
    const panel = await open();

    const next = await within(panel).findByRole("region", { name: "Next" });
    expect(await within(next).findByText("Which lane?")).toBeTruthy();
    expect(within(panel).getByRole("region", { name: "Questions" }).textContent).not.toContain(
      "Which lane?",
    );
    expect(primaries(panel)).toHaveLength(1);
  });

  it("GivenATicket_WhenThePanelOpens_ThenHowItRunsIsCollapsedAndNamesWorkerExecutorAndTier", async () => {
    const { open } = await seeded();
    const panel = await open();

    const group = await within(panel).findByRole("group", { name: "How it runs" });
    expect((group as HTMLDetailsElement).open).toBe(false);
    const summary = group.querySelector("summary")!;
    await within(summary).findByText(/Agent · GitHub Actions · \w+ tier/);
    // Every control the rail had stays inside it.
    expect(within(group).getByRole("button", { name: "Make it mine" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Run locally" })).toBeTruthy();
    expect(within(group).getByRole("region", { name: "Overrides" })).toBeTruthy();
    expect(await within(group).findByRole("region", { name: "Routing" })).toBeTruthy();
  });

  it("GivenATicket_WhenThePanelOpens_ThenDetailsHoldsTheFactsAndCancelSitsLast", async () => {
    const { open } = await seeded();
    const panel = await open();

    const rail = await within(panel).findByRole("complementary", { name: "Details" });
    for (const label of ["Type", "Size", "Epic"]) expect(within(rail).getByLabelText(label));
    expect(within(rail).getByRole("region", { name: "Blocked by" })).toBeTruthy();
    const sections = rail.querySelectorAll(":scope > *");
    expect(sections[sections.length - 1]!.getAttribute("aria-label")).toBe("Cancel and archive");
  });

  it("GivenAnEpicInAMilestone_WhenThePanelOpens_ThenOutcomeTicketsAndMilestoneComeBeforeTheDescription", async () => {
    const {
      milestones,
      tracker,
      service,
      open,
      ticket: epic,
    } = await seeded({ type: "epic", title: "Releases" });
    await milestones.create({
      id: "m6",
      projectId: "ai",
      name: "M6: Releases",
      outcome: "Releases work",
      order: 6,
      status: "approved",
      createdAt: AT,
      updatedAt: AT,
    });
    await tracker.updateTicket("ai", epic.id, { fields: { milestoneId: "m6" } }, "andy");
    await service.create("ai", { title: "Promote", parentId: epic.id }, "andy");
    const panel = await open();

    const outcome = await within(panel).findByRole("region", { name: "Outcome" });
    const tickets = await within(panel).findByRole("region", { name: "Tickets" });
    const milestone = await within(panel).findByRole("region", { name: "Milestone" });
    const description = within(panel).getByRole("heading", { name: "Description" });
    expect(before(outcome, tickets)).toBe(true);
    expect(before(tickets, milestone)).toBe(true);
    expect(before(milestone, description)).toBe(true);
    const rail = within(panel).getByRole("complementary", { name: "Details" });
    expect(within(rail).queryByRole("region", { name: "Milestone" })).toBeNull();
  });
});

/** AI-330: empty list fields fold into one Add row; a field with items shows as before. */
describe("list fields", () => {
  const LISTS = ["Acceptance criteria", "Assumptions", "Out of scope", "Touches"];

  it("GivenATicketWithNoListItems_WhenThePanelOpens_ThenNoListHeadingsShowAndOneAddRowOffersEach", async () => {
    const { open } = await seeded({ type: "feature", title: "Bare" });
    const panel = await open();

    const add = await within(panel).findByLabelText("Add a list");
    for (const name of LISTS) {
      expect(within(panel).queryByRole("heading", { name })).toBeNull();
      expect(within(add).getByRole("option", { name })).toBeTruthy();
    }
  });

  it("GivenOneListHasItems_WhenThePanelOpens_ThenItShowsAsTodayAndOnlyTheOthersFold", async () => {
    const { open } = await seeded({ type: "feature", title: "Some", touches: ["apps/web/**"] });
    const panel = await open();

    const touches = await within(panel).findByRole("region", { name: "Touches" });
    expect(within(touches).getByText("apps/web/**")).toBeTruthy();
    const add = within(panel).getByLabelText("Add a list");
    expect(within(add).queryByRole("option", { name: "Touches" })).toBeNull();
    expect(within(add).getByRole("option", { name: "Out of scope" })).toBeTruthy();
  });

  it("GivenTheAddRow_WhenAndyPicksAListByKeyboardAndAddsAnItem_ThenTheFieldShowsFocusedAndSaves", async () => {
    const { open, tracker, ticket, user } = await seeded({ type: "feature", title: "Bare" });
    const panel = await open();

    const add = await within(panel).findByLabelText("Add a list");
    add.focus();
    await user.selectOptions(add, "Out of scope");
    const input = within(panel).getByLabelText("Add to out of scope");
    expect(document.activeElement).toBe(input);
    await user.type(input, "billing{Enter}");

    const field = within(panel).getByRole("region", { name: "Out of scope" });
    expect(await within(field).findByText("billing")).toBeTruthy();
    expect(
      within(within(panel).getByLabelText("Add a list")).queryByRole("option", {
        name: "Out of scope",
      }),
    ).toBeNull();
    expect((await tracker.getTicket("ai", ticket.id))?.outOfScope).toEqual(["billing"]);
  });

  it("GivenAllListsHaveItems_WhenThePanelOpens_ThenThereIsNoAddRow", async () => {
    const { open } = await seeded({
      type: "feature",
      title: "Full",
      acceptanceCriteria: ["a"],
      assumptions: ["b"],
      outOfScope: ["c"],
      touches: ["d"],
    });
    const panel = await open();

    await within(panel).findByRole("region", { name: "Touches" });
    expect(within(panel).queryByLabelText("Add a list")).toBeNull();
  });

  it("GivenAShownList_WhenItsLastItemIsRemoved_ThenTheFieldStaysUntilTheTicketCloses", async () => {
    const { open, user } = await seeded({ type: "feature", title: "One", touches: ["x"] });
    const panel = await open();

    await user.click(await within(panel).findByRole("button", { name: "Remove: x" }));

    await within(panel).findByLabelText("Add to touches");
    expect(within(panel).getByRole("region", { name: "Touches" })).toBeTruthy();
  });
});
