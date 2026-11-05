import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { readyStory, renderApp } from "@/test/harness";

/** UI flows from the M1.3: UI: tickets + inbox "Done when", against the in-process API. */

describe("tickets UI", () => {
  it("GivenNoProjects_WhenAndyCreatesAProjectAndTicket_ThenTheTicketIsInBacklog", async () => {
    const { user } = renderApp("/projects");
    expect(await screen.findByText("No projects yet.")).toBeTruthy();

    await user.type(screen.getByLabelText("Name"), "Andy Intelligence");
    await user.type(screen.getByLabelText(/^Key/), "ai");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    await user.click(await screen.findByRole("button", { name: "New ticket" }));
    await user.type(screen.getByLabelText("Title"), "Ticket board");
    await user.click(screen.getByRole("button", { name: "Create ticket" }));

    const backlog = await screen.findByRole("region", { name: "Backlog" });
    expect(await within(backlog).findByText("Ticket board")).toBeTruthy();
    expect(within(backlog).getByText("AI-1")).toBeTruthy();
  });

  it("GivenARepo_WhenAndyCreatesAProject_ThenTheProjectListsIt", async () => {
    const harness = renderApp("/projects", { githubConnected: true });
    await harness.user.type(await screen.findByLabelText("Name"), "Andy Intelligence");
    await harness.user.type(screen.getByLabelText(/^Key/), "ai");
    await harness.user.type(screen.getByLabelText(/^GitHub repo/), "albernhagen/andy-intelligence");
    await harness.user.click(screen.getByRole("button", { name: "Create project" }));

    await screen.findByRole("button", { name: "New ticket" });
    expect((await harness.tracker.getProject("ai"))?.repos).toEqual([
      "albernhagen/andy-intelligence",
    ]);
  });

  it("GivenAProject_WhenAndyUnticksAutoRefine_ThenTheProjectStoresIt", async () => {
    const harness = renderApp("/projects");
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    await harness.router.invalidate();
    const toggle = await screen.findByRole("checkbox", { name: "Auto-refine" });
    expect((toggle as HTMLInputElement).checked).toBe(true);

    await harness.user.click(toggle);
    await waitFor(async () =>
      expect((await harness.tracker.getProject("ai"))?.autoRefine).toBe(false),
    );
  });

  it("GivenATicket_WhenAndyEditsIt_ThenFieldsAndHistoryUpdate", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "story", title: "Board" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("Problem / intent"), "Andy can't see tickets.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Andy can't see tickets.")).toBeTruthy();
    const history = screen.getByRole("region", { name: "History" });
    expect(await within(history).findByText(/changed body/)).toBeTruthy();
  });

  it("GivenATicketChangedElsewhere_WhenSavingAnEdit_ThenAConflictIsShown", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "story", title: "Board" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await harness.service.update("ai", ticket.id, { title: "Renamed elsewhere" }, "andy");
    await user.type(screen.getByLabelText("Problem / intent"), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/changed since it was read/)).toBeTruthy();
    expect(screen.getByText(/Cancel to see the latest/)).toBeTruthy();
  });

  it("GivenATicketMissingDoR_WhenMovedToReady_ThenTheMissingItemsAreShown", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "story", title: "Board" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });

    const dor = await screen.findByRole("region", { name: "Definition of Ready" });
    expect(await within(dor).findByText("acceptance criteria")).toBeTruthy();

    await harness.user.click(screen.getByRole("button", { name: "Move to Ready" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Definition of Ready not met: .*size/,
    );
    expect((await harness.tracker.getTicket("ai", ticket.id))?.stage).toBe("backlog");
  });

  it("GivenAReadyTicket_WhenMovedForward_ThenTheStageChangesAndHistoryRecordsIt", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", readyStory, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });

    const dor = await screen.findByRole("region", { name: "Definition of Ready" });
    expect(await within(dor).findByText("Met.")).toBeTruthy();
    await harness.user.click(screen.getByRole("button", { name: "Move to Ready" }));

    // From Ready the domain allows In progress and back to Backlog.
    expect(await screen.findByRole("button", { name: "Move to In progress" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to Backlog" })).toBeTruthy();
    const history = screen.getByRole("region", { name: "History" });
    expect(await within(history).findByText(/moved Backlog → Ready/)).toBeTruthy();
  });

  it("GivenATicket_WhenAndyForcesAMoveWithAReason_ThenHistoryRecordsTheReason", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "story", title: "Board" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;

    await user.click(await screen.findByRole("button", { name: "Force move…" }));
    const submit = screen.getByRole("button", { name: "Force move" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText("Force to"), "Done");
    await user.type(screen.getByLabelText("Reason (optional)"), "shipped by hand");
    await user.click(submit);

    const history = screen.getByRole("region", { name: "History" });
    expect(await within(history).findByText(/force-moved Backlog → Done/)).toBeTruthy();
    expect(within(history).getByText("shipped by hand")).toBeTruthy();
    expect((await harness.tracker.getTicket("ai", ticket.id))?.stage).toBe("done");
  });

  it("GivenATicketMissingDoR_WhenAndyForcesItToReadyWithNoReason_ThenItMovesAnyway", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "story", title: "Board" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;

    await user.click(await screen.findByRole("button", { name: "Force move…" }));
    await user.selectOptions(screen.getByLabelText("Force to"), "Ready");
    await user.click(screen.getByRole("button", { name: "Force move" }));

    const history = screen.getByRole("region", { name: "History" });
    expect(await within(history).findByText(/force-moved Backlog → Ready/)).toBeTruthy();
    expect((await harness.tracker.getTicket("ai", ticket.id))?.stage).toBe("ready");
  });
});

describe("cancel and archive", () => {
  it("GivenATicket_WhenAndyCancelsItWithAReasonAndArchivesIt_ThenTheBoardHidesItUntilShowArchived", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", readyStory, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;

    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Cancel ticket…" }));
    await user.type(screen.getByLabelText("Why cancel (optional)"), "not needed");
    await user.click(screen.getByRole("button", { name: "Cancel ticket" }));

    const history = screen.getByRole("region", { name: "History" });
    expect(await within(history).findByText(/moved Backlog → Cancelled/)).toBeTruthy();
    expect(within(history).getByText("not needed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to Backlog" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("button", { name: "Unarchive" })).toBeTruthy();
    expect((await harness.tracker.getTicket("ai", ticket.id))?.archived).toBe(true);

    await harness.router.navigate({ to: "/p/ai" });
    const cancelled = await screen.findByRole("region", { name: "Cancelled" });
    expect(within(cancelled).queryByText(/Board/)).toBeNull();
    await user.click(screen.getByLabelText("Show archived"));
    expect(await within(cancelled).findByText(/Board/)).toBeTruthy();
  });

  it("GivenACancelledTicket_WhenAndyReopensIt_ThenItIsBackInBacklog", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", readyStory, "andy");
    await harness.service.cancel("ai", ticket.id, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });

    await harness.user.click(await screen.findByRole("button", { name: "Move to Backlog" }));
    expect(await screen.findByRole("button", { name: "Cancel ticket…" })).toBeTruthy();
    expect((await harness.tracker.getTicket("ai", ticket.id))?.stage).toBe("backlog");
  });
});

describe("Needs-you inbox", () => {
  it("GivenNothingOpen_WhenOpeningTheInbox_ThenItSaysNothingNeedsYou", async () => {
    renderApp("/");
    expect(await screen.findByText("Nothing needs you.")).toBeTruthy();
  });

  it("GivenASeededQuestion_WhenAndyAnswersFromTheInbox_ThenItLeavesTheInboxAndTheTicketIsUnflagged", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", readyStory, "andy");
    await harness.service.ask(
      "ai",
      ticket.id,
      { text: "Which layout?", options: ["Columns", "List"], suggestedAnswer: "Columns" },
      "agent:run-1",
    );
    await harness.router.navigate({ to: "/" });
    const { user } = harness;

    const card = await screen.findByRole("article", { name: "Question: Which layout?" });
    expect(within(card).getByRole("link", { name: "AI-1: Board" })).toBeTruthy();
    // The suggested answer is pre-filled; picking an option replaces it.
    expect((within(card).getByLabelText("Answer") as HTMLInputElement).value).toBe("Columns");
    await user.click(within(card).getByRole("button", { name: "List" }));
    await user.click(within(card).getByRole("button", { name: "Answer" }));

    expect(await screen.findByText("Nothing needs you.")).toBeTruthy();
    const after = await harness.tracker.getTicket("ai", ticket.id);
    expect(after).toMatchObject({ needsYou: false, dorStatus: "met" });
    const [question] = await harness.tracker.listQuestions({ ticketId: ticket.id });
    expect(question).toMatchObject({ status: "answered", answer: "List", answeredVia: "ui" });
  });

  it("GivenATicket_WhenAndyAsksAQuestionOnIt_ThenTheTicketIsFlaggedAndTheQuestionIsInTheInbox", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", readyStory, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;

    await user.click(await screen.findByRole("button", { name: "Ask a question…" }));
    await user.type(screen.getByLabelText("Question"), "Dark mode too?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("needs you")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Needs you" }));
    expect(await screen.findByRole("article", { name: "Question: Dark mode too?" })).toBeTruthy();
    await waitFor(async () =>
      expect((await harness.tracker.getTicket("ai", ticket.id))?.needsYou).toBe(true),
    );
  });
});
