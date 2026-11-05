import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_ROUTE } from "@andy/domain";
import { readyStory, renderApp } from "@/test/harness";

/** AI-29: Story panel: the ticket as a side panel with a status line and markdown. */

async function seeded(fields: Record<string, unknown> = {}) {
  const harness = renderApp();
  await harness.tracker.createProject({ name: "AI", key: "AI" });
  const ticket = await harness.service.create(
    "ai",
    { type: "feature", title: "Board", ...fields },
    "andy",
  );
  const open = async (path = "/p/ai/t/AI-1") => {
    await harness.router.navigate({ to: path });
    return screen.findByRole("dialog", { name: /^AI-1: / });
  };
  return { ...harness, ticket, open };
}

const status = () => screen.getByRole("status", { name: "Status" });

describe("story panel", () => {
  it("GivenTheBoard_WhenAndyClicksACard_ThenThePanelOpensOverTheBoardAndTheUrlIsTheTickets", async () => {
    const { router, user } = await seeded();
    await router.navigate({ to: "/p/ai" });

    await user.click(await screen.findByRole("link", { name: /^AI-1 / }));

    expect(await screen.findByRole("dialog", { name: "AI-1: Board" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/p/ai/t/AI-1");
    expect(screen.getByRole("region", { name: "Backlog" })).toBeTruthy();
  });

  it("GivenATicketUrl_WhenOpenedDirectly_ThenTheBoardShowsWithThePanelOpen", async () => {
    const { open } = await seeded();
    const panel = await open();
    expect(within(panel).getByRole("heading", { name: "AI-1: Board" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Backlog" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^AI-1 / })).toBeTruthy();
  });

  it("GivenThePanel_WhenAndyPressesEsc_ThenItClosesToTheBoard", async () => {
    const { open, router, user } = await seeded();
    await open();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/p/ai"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByRole("region", { name: "Backlog" })).toBeTruthy();
  });

  it("GivenThePanel_WhenAndyClicksClose_ThenItClosesToTheBoard", async () => {
    const { open, router, user } = await seeded();
    const panel = await open();
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/p/ai"));
  });

  it("GivenAFieldBeingEdited_WhenAndyPressesEsc_ThenTheEditIsCancelledAndThePanelStays", async () => {
    const { open, router, user } = await seeded();
    const panel = await open();
    await user.click(within(panel).getByRole("button", { name: "Board" }));
    await user.type(within(panel).getByLabelText("Title"), " v2");
    await user.keyboard("{Escape}");

    expect(within(panel).queryByLabelText("Title")).toBeNull();
    expect(within(panel).getByRole("heading", { name: "AI-1: Board" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/p/ai/t/AI-1");
  });
});

describe("status line", () => {
  it("GivenOpenQuestions_WhenThePanelOpens_ThenItSaysItIsWaitingForAndy", async () => {
    const { open, service, ticket } = await seeded();
    await service.ask("ai", ticket.id, { text: "Columns or list?" }, "agent:run-1");
    await service.ask("ai", ticket.id, { text: "Dark mode?" }, "agent:run-1");
    await open();
    await waitFor(() => expect(status().textContent).toBe("Waiting for you: 2 questions"));
  });

  it("GivenARefineRunInFlight_WhenThePanelOpens_ThenItSaysRefining", async () => {
    const { open, runs, ticket } = await seeded();
    const run = await runs.create({
      projectId: "ai",
      ticketId: ticket.id,
      step: "refine",
      route: DEFAULT_ROUTE,
      tier: null,
      deadline: null,
      prompt: "refine it",
      maxTurns: 10,
    });
    await runs.update(run.id, { status: "running", startedAt: new Date().toISOString() }, [
      "queued",
    ]);
    await open();
    await waitFor(() => expect(status().textContent).toBe("Refining · 1 min"));
  });

  it("GivenTheTopReadyTicket_WhenThePanelOpens_ThenItIsNextInTheQueue", async () => {
    const { open, service, ticket } = await seeded(readyStory);
    await service.move("ai", ticket.id, "ready", "andy");
    await open();
    await waitFor(() => expect(status().textContent).toBe("Ready · next in the queue"));
  });

  it("GivenAndyAddsABlocker_WhenSaved_ThenTheStatusSaysBlocked", async () => {
    const { open, service, user } = await seeded(readyStory);
    await service.create("ai", { type: "chore", title: "Auth" }, "andy");
    const panel = await open();
    await waitFor(() => expect(status().textContent).toBe("Backlog · ready to move to Ready"));

    await user.selectOptions(within(panel).getByLabelText("Add a blocker"), "AI-2: Auth");

    await waitFor(() => expect(status().textContent).toBe("Blocked by AI-2"));
    const blockers = within(panel).getByRole("region", { name: "Blocked by" });
    expect(within(blockers).getByRole("link", { name: "AI-2: Auth" })).toBeTruthy();
  });
});

describe("one document, edited in place", () => {
  it("GivenAChore_WhenThePanelOpens_ThenTheChecklistIsDoneWhen", async () => {
    const { open } = await seeded({ type: "chore" });
    const panel = await open();
    expect(within(panel).getByRole("region", { name: "Done when" })).toBeTruthy();
    expect(within(panel).queryByRole("region", { name: "Acceptance criteria" })).toBeNull();
  });

  it("GivenThePanel_WhenAndyRenamesTheTicket_ThenItSavesWithoutLeavingThePanel", async () => {
    const { open, router, tracker, ticket, user } = await seeded();
    const panel = await open();
    await user.click(within(panel).getByRole("button", { name: "Board" }));
    const input = within(panel).getByLabelText("Title");
    await user.clear(input);
    await user.type(input, "Story board{Enter}");

    expect(await within(panel).findByRole("heading", { name: "AI-1: Story board" })).toBeTruthy();
    expect((await tracker.getTicket("ai", ticket.id))?.title).toBe("Story board");
    expect(router.state.location.pathname).toBe("/p/ai/t/AI-1");
  });

  it("GivenTheChecklist_WhenAndyAddsAndRemovesItems_ThenTheListIsSaved", async () => {
    const { open, tracker, ticket, user } = await seeded({ acceptanceCriteria: ["first"] });
    const panel = await open();
    const list = within(panel).getByRole("region", { name: "Acceptance criteria" });

    await user.type(within(list).getByLabelText("Add to acceptance criteria"), "second{Enter}");
    await within(list).findByRole("button", { name: "Remove: second" });
    await user.click(within(list).getByRole("button", { name: "Remove: first" }));

    await waitFor(async () =>
      expect((await tracker.getTicket("ai", ticket.id))?.acceptanceCriteria).toEqual(["second"]),
    );
    expect(within(list).queryByText("first")).toBeNull();
  });

  it("GivenTheDescriptionEditor_WhenAndyPreviews_ThenTheMarkdownIsRendered", async () => {
    const { open, user } = await seeded();
    const panel = await open();
    await user.click(within(panel).getByRole("button", { name: "Edit description" }));
    await user.type(within(panel).getByLabelText("Description"), "Some **bold** text");
    await user.click(within(panel).getByRole("button", { name: "Preview" }));

    expect(within(panel).getByText("bold").tagName).toBe("STRONG");
    await user.click(within(panel).getByRole("button", { name: "Write" }));
    expect((within(panel).getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
      "Some **bold** text",
    );
  });

  it("GivenAnAnswerableQuestion_WhenAndyAnswersInThePanel_ThenTheStatusMovesOn", async () => {
    const { open, service, ticket, user } = await seeded(readyStory);
    await service.ask(
      "ai",
      ticket.id,
      { text: "Use **columns**?", options: ["Yes", "No"] },
      "agent:run-1",
    );
    const panel = await open();
    const card = await within(panel).findByRole("article", { name: "Question: Use **columns**?" });
    expect(within(card).getByText("columns").tagName).toBe("STRONG");

    await user.click(within(card).getByRole("button", { name: "Yes" }));
    expect(status().textContent).toBe("Waiting for you: 1 question");
    await user.click(within(card).getByRole("button", { name: "Answer" }));

    // Answered and ready, the ticket moves on to Ready (M1.7: Refinement).
    await waitFor(() => expect(status().textContent).toBe("Ready · next in the queue"));
  });
});

describe("activity timeline", () => {
  it("GivenEventsCommentsAndARun_WhenThePanelOpens_ThenTheyShowInOneTimeline", async () => {
    const { open, runs, service, ticket, user } = await seeded();
    await runs.create({
      projectId: "ai",
      ticketId: ticket.id,
      step: "refine",
      route: DEFAULT_ROUTE,
      tier: null,
      deadline: null,
      prompt: "refine it",
      maxTurns: 10,
    });
    await service.comment("ai", ticket.id, "Looks **good**", "andy");
    const panel = await open();
    const activity = await within(panel).findByRole("region", { name: "Activity" });
    await within(activity).findByText("good");
    // One list: history, the run and the comment (order: `timeline` in lib/tickets.test.ts).
    const items = within(activity).getAllByRole("listitem");
    expect(items.map((i) => i.textContent).join("|")).toMatch(/created the ticket/);
    expect(items.some((i) => /refine/.test(i.textContent ?? ""))).toBe(true);
    expect(items.some((i) => /commented/.test(i.textContent ?? ""))).toBe(true);
    expect(within(activity).getByText("good").tagName).toBe("STRONG");

    await user.type(within(activity).getByLabelText("Comment"), "A [[link](https://example.com)");
    await user.click(within(activity).getByRole("button", { name: "Comment" }));
    const link = await within(activity).findByRole("link", { name: "link" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(within(activity).getByText("(example.com)")).toBeTruthy();
  });
});

describe("untrusted markdown in the panel", () => {
  const hostile = [
    "<script>window.pwned = 1</script>",
    '<img src="https://evil.example/x.png" onerror="window.pwned = 2">',
    "[click](javascript:window.pwned=3)",
    "![pixel](https://evil.example/pixel.gif)",
    "<b>raw</b>",
  ].join("\n\n");

  it("GivenHostileMarkdownInADescriptionCommentAndQuestion_WhenShown_ThenNothingRunsOrLoads", async () => {
    const { open, service, ticket } = await seeded({ body: hostile });
    await service.comment("ai", ticket.id, hostile, "agent:run-1");
    await service.ask("ai", ticket.id, { text: hostile }, "agent:run-1");
    const panel = await open();
    await within(panel).findAllByText("pixel");

    expect(panel.querySelector("script, img, iframe, b, [onerror], [onclick]")).toBeNull();
    for (const a of panel.querySelectorAll("a"))
      expect(a.getAttribute("href")).not.toMatch(/^\s*javascript:/i);
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    // The remote image is a link to it, never loaded.
    for (const pixel of within(panel).getAllByRole("link", { name: "pixel" }))
      expect(pixel.getAttribute("href")).toBe("https://evil.example/pixel.gif");
  });

  it("GivenADescriptionWithALink_WhenAndyClicksTheLink_ThenTheEditorDoesNotOpen", async () => {
    const { open } = await seeded({ body: "[docs](https://example.com)" });
    const panel = await open();
    fireEvent.click(within(panel).getByRole("link", { name: "docs" }));
    expect(within(panel).queryByLabelText("Description")).toBeNull();
  });
});

describe("unsaved drafts and quick saves (PR #80 review)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function withDraft(harness: Awaited<ReturnType<typeof seeded>>) {
    const panel = await harness.open();
    await harness.user.click(within(panel).getByRole("button", { name: "Edit description" }));
    await harness.user.type(within(panel).getByLabelText("Description"), "half-written");
    return panel;
  }

  it("GivenADraftOnOneTicket_WhenAndySwitchesToAnotherCachedTicket_ThenTheDraftIsNotCarriedOver", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const harness = await seeded();
    await harness.service.create("ai", { type: "chore", title: "Auth" }, "andy");
    // AI-2 is in the query cache before AI-1 opens, so switching back shows no loading state.
    await harness.router.navigate({ to: "/p/ai/t/AI-2" });
    await screen.findByRole("dialog", { name: "AI-2: Auth" });
    await withDraft(harness);

    await harness.router.navigate({ to: "/p/ai/t/AI-2" });

    const panel = await screen.findByRole("dialog", { name: "AI-2: Auth" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(within(panel).queryByLabelText("Description")).toBeNull();
    expect(within(panel).queryByText("half-written")).toBeNull();
  });

  it("GivenUnsavedTyping_WhenAndyClosesAndCancelsTheConfirm_ThenThePanelAndDraftStay", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const harness = await seeded();
    const panel = await withDraft(harness);

    await harness.user.click(within(panel).getByRole("button", { name: "Close" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(harness.router.state.location.pathname).toBe("/p/ai/t/AI-1");
    expect((within(panel).getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
      "half-written",
    );

    confirm.mockReturnValue(true);
    await harness.user.click(within(panel).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(harness.router.state.location.pathname).toBe("/p/ai"));
  });

  it("GivenNoUnsavedTyping_WhenAndyCloses_ThenItClosesWithoutAsking", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const harness = await seeded();
    const panel = await harness.open();
    await harness.user.click(within(panel).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(harness.router.state.location.pathname).toBe("/p/ai"));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("GivenTwoFieldsChangedBeforeTheFirstSaveReturns_WhenSaved_ThenBothSaveWithoutAConflict", async () => {
    const harness = await seeded();
    const panel = await harness.open();

    // Both changes in the same tick: the second save starts before the first returns.
    fireEvent.change(within(panel).getByLabelText("Size"), { target: { value: "M" } });
    fireEvent.change(within(panel).getByLabelText("Type"), { target: { value: "bug" } });

    await waitFor(async () =>
      expect(await harness.tracker.getTicket("ai", harness.ticket.id)).toMatchObject({
        size: "M",
        type: "bug",
      }),
    );
    expect(within(panel).queryByRole("alert")).toBeNull();
  });
});
