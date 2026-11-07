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

    await user.type(await screen.findByLabelText("Add a ticket"), "Ticket board{Enter}");

    const backlog = await screen.findByRole("region", { name: "Backlog" });
    expect(await within(backlog).findByText("Ticket board")).toBeTruthy();
    expect(within(backlog).getByText("AI-1")).toBeTruthy();
  });

  it("GivenATitleOnlyTicket_WhenAndySetsTypeScopeAndPinsATierInPlace_ThenTheyAreSavedAndShown", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { title: "Board" }, "andy");
    expect(ticket.type).toBeNull();
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;
    const type = (await screen.findByLabelText("Type")) as HTMLSelectElement;
    expect(type.value).toBe("");

    // Each rail field saves as soon as it changes; no Save button, no page change.
    await user.selectOptions(type, "Bug");
    await waitFor(() => expect(type.disabled).toBe(false));
    await user.selectOptions(screen.getByLabelText("Size"), "M");
    const tier = screen.getByLabelText("Tier") as HTMLSelectElement;
    expect(await within(tier).findByRole("option", { name: "strong (from size)" })).toBeTruthy();
    await user.selectOptions(tier, "frontier");
    await user.type(screen.getByLabelText("Add to out of scope"), "billing{Enter}");
    await screen.findByRole("button", { name: "Remove: billing" });
    await user.type(screen.getByLabelText("Add to touches"), "apps/web/**{Enter}");

    await waitFor(async () =>
      expect(await harness.tracker.getTicket("ai", ticket.id)).toMatchObject({
        type: "bug",
        size: "M",
        overrides: { tier: "frontier" },
        outOfScope: ["billing"],
        touches: ["apps/web/**"],
      }),
    );
    await waitFor(() => expect(tier.value).toBe("frontier"));
    expect(type.value).toBe("bug");
    expect(harness.router.state.location.pathname).toBe("/p/ai/t/AI-1");
  });

  it("GivenARepo_WhenAndyCreatesAProject_ThenTheProjectListsIt", async () => {
    const harness = renderApp("/projects", { githubConnected: true });
    await harness.user.type(await screen.findByLabelText("Name"), "Andy Intelligence");
    await harness.user.type(screen.getByLabelText(/^Key/), "ai");
    await harness.user.type(screen.getByLabelText(/^GitHub repo/), "albernhagen/andy-intelligence");
    await harness.user.click(screen.getByRole("button", { name: "Create project" }));

    await screen.findByLabelText("Add a ticket");
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

  it("GivenATicket_WhenAndyEditsTheDescription_ThenItIsSavedAndTheActivityRecordsIt", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "feature", title: "Board" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;

    await user.click(await screen.findByRole("button", { name: "Edit description" }));
    await user.type(screen.getByLabelText("Description"), "Andy can't see tickets.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Andy can't see tickets.")).toBeTruthy();
    const activity = screen.getByRole("region", { name: "Activity" });
    expect(await within(activity).findByText(/changed body/)).toBeTruthy();
  });

  it("GivenATicketChangedElsewhere_WhenSavingAnEdit_ThenAConflictAsksForAReloadAndTheDraftSurvives", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "feature", title: "Board" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;

    await user.click(await screen.findByRole("button", { name: "Edit description" }));
    await harness.service.update("ai", ticket.id, { title: "Renamed elsewhere" }, "andy");
    await user.type(screen.getByLabelText("Description"), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/changed since it was read/)).toBeTruthy();
    expect(screen.getByText(/Reload to see the latest/)).toBeTruthy();

    // Reload fetches the latest; the draft is still there and now saves.
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByRole("heading", { name: "AI-1: Renamed elsewhere" })).toBeTruthy();
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("x");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () =>
      expect((await harness.tracker.getTicket("ai", ticket.id))?.body).toBe("x"),
    );
  });

  it("GivenATicketMissingDoR_WhenMovedToReady_ThenTheMissingItemsAreShown", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "feature", title: "Board" }, "andy");
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
    expect(await within(dor).findByText("Definition of Ready: met.")).toBeTruthy();
    await harness.user.click(screen.getByRole("button", { name: "Move to Ready" }));

    // From Ready the domain allows In progress and back to Backlog.
    expect(await screen.findByRole("button", { name: "Move to In progress" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to Backlog" })).toBeTruthy();
    const history = screen.getByRole("region", { name: "Activity" });
    expect(await within(history).findByText(/moved Backlog → Ready/)).toBeTruthy();
  });

  it("GivenATicket_WhenAndyForcesAMoveWithAReason_ThenHistoryRecordsTheReason", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "feature", title: "Board" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;

    await user.click(await screen.findByRole("button", { name: "Force move…" }));
    const submit = screen.getByRole("button", { name: "Force move" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText("Force to"), "Done");
    await user.type(screen.getByLabelText("Reason (optional)"), "shipped by hand");
    await user.click(submit);

    const history = screen.getByRole("region", { name: "Activity" });
    expect(await within(history).findByText(/force-moved Backlog → Done/)).toBeTruthy();
    expect(within(history).getByText("shipped by hand")).toBeTruthy();
    expect((await harness.tracker.getTicket("ai", ticket.id))?.stage).toBe("done");
  });

  it("GivenATicketMissingDoR_WhenAndyForcesItToReadyWithNoReason_ThenItMovesAnyway", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "feature", title: "Board" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    const { user } = harness;

    await user.click(await screen.findByRole("button", { name: "Force move…" }));
    await user.selectOptions(screen.getByLabelText("Force to"), "Ready");
    await user.click(screen.getByRole("button", { name: "Force move" }));

    const history = screen.getByRole("region", { name: "Activity" });
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

    const history = screen.getByRole("region", { name: "Activity" });
    expect(await within(history).findByText(/moved Backlog → Cancelled/)).toBeTruthy();
    expect(within(history).getByText("not needed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to Backlog" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("button", { name: "Unarchive" })).toBeTruthy();
    expect((await harness.tracker.getTicket("ai", ticket.id))?.archived).toBe(true);

    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByRole("region", { name: "Backlog" });
    expect(screen.queryByRole("region", { name: "Cancelled" })).toBeNull();
    await user.click(screen.getByLabelText("Show cancelled and archived"));
    const cancelled = screen.getByRole("region", { name: "Cancelled" });
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
    expect(after).toMatchObject({ needsAttention: false, dorStatus: "met" });
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

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Status" }).textContent).toBe(
        "Waiting for you: 1 question",
      ),
    );
    await user.click(await screen.findByRole("link", { name: "Needs you 1" }));
    expect(await screen.findByRole("article", { name: "Question: Dark mode too?" })).toBeTruthy();
    await waitFor(async () =>
      expect((await harness.tracker.getTicket("ai", ticket.id))?.needsAttention).toBe(true),
    );
  });
});
