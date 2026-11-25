import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { NewQuestion } from "@andy/contracts";
import { resetToasts, Toaster } from "@/components/ui/toast";
import { PAGE_LOAD, readyStory, renderApp } from "@/test/harness";
import { emulateWidth } from "@/test/phone";

/**
 * AI-30: Inbox v2: questions grouped by ticket, one-click suggested answers. AI-371: a list of
 * tickets beside the picked one's decisions; one decision at a time on a phone.
 */

type Harness = ReturnType<typeof renderApp>;

/**
 * Asks questions the way a refine run does (id `<runId>-q<n>`, not a UUID) and flags the ticket,
 * as `RunService` does after writing them.
 */
async function askAsRun(h: Harness, ticketId: string, runId: string, questions: NewQuestion[]) {
  const asked = await h.tracker.askQuestions("ai", ticketId, questions, `agent:${runId}`, runId);
  await h.tracker.updateTicket(
    "ai",
    ticketId,
    { fields: { needsAttention: true, dorStatus: "not_met" } },
    "system",
  );
  return asked;
}

const layout: NewQuestion = {
  text: "Which layout?",
  options: ["Columns", "List"],
  suggestedAnswer: "List",
  assumptions: ["Desktop first"],
};
const colour: NewQuestion = { text: "Which colour?", options: [], suggestedAnswer: "Blue" };
const noSuggestion: NewQuestion = { text: "Who signs off?", options: ["Andy", "Nobody"] };

/** Opens `path` once seeding is done, refetching anything loaded while it ran. */
async function open(h: Harness, path: string) {
  await h.queryClient.invalidateQueries();
  await h.router.navigate({ href: path });
}

/** AI-1 (ready apart from its questions) has two questions, AI-2 (no size yet) one. */
async function twoTickets(path = "/p/ai/inbox", more?: (h: Harness) => Promise<void>) {
  const h = renderApp("/all/board");
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const board = await h.service.create("ai", readyStory, "andy", { upNext: true });
  const panel = await h.service.create("ai", { type: "feature", title: "Panel" }, "andy");
  // Created first, so it sorts first by age: the readiness rule must still put AI-1 on top.
  await askAsRun(h, panel.id, "run2", [noSuggestion]);
  await askAsRun(h, board.id, "run1", [layout, colour]);
  await more?.(h);
  await open(h, path);
  return { ...h, board, panel };
}

/** Picks the ticket's row in the list, then returns its detail. */
async function card(name: string) {
  fireEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("article", { name });
}
const question = (text: string) => screen.queryByRole("listitem", { name: `Question: ${text}` });
/** The list's rows, in order. */
const rows = () =>
  screen
    .queryAllByRole("button")
    .filter((b) => b.hasAttribute("data-nav-item"))
    .map((b) => b.getAttribute("aria-label"));

afterEach(() => {
  vi.unstubAllGlobals();
  resetToasts();
});

describe("inbox v2", () => {
  it("GivenQuestionsOnSeveralTickets_WhenTheInboxOpens_ThenARowPerTicketSitsBesideThePickedOnesQuestions", async () => {
    await twoTickets();
    // The first row is picked: its questions show beside the list, no other ticket's.
    const board = await screen.findByRole("article", { name: "AI-1: Board" });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "AI-1: Board" }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(screen.getByText("2 questions · 2 with a suggestion")).toBeTruthy();
    expect(screen.getAllByText("Who signs off?")).toHaveLength(1);
    expect(within(board).getAllByRole("listitem", { name: /^Question:/ })).toHaveLength(2);
    expect(within(board).getByRole("listitem", { name: "Question: Which layout?" })).toBeTruthy();
    expect(within(board).getByText("Feature")).toBeTruthy();
    expect(within(board).getByText("Backlog")).toBeTruthy();
    expect(within(board).getByRole("link", { name: "Open ticket" }).getAttribute("href")).toBe(
      "/p/ai/t/AI-1",
    );

    const panel = await card("AI-2: Panel");
    expect(within(panel).getByRole("listitem", { name: "Question: Who signs off?" })).toBeTruthy();
    expect(question("Which layout?")).toBeNull();
  });

  it("GivenATicketWhoseOnlyGapIsQuestions_WhenTheInboxOpens_ThenItsRowComesFirst", async () => {
    await twoTickets();
    await screen.findByRole("article", { name: "AI-1: Board" });
    expect(rows()).toEqual(["AI-1: Board", "AI-2: Panel"]);
  });

  it("GivenAQuestion_WhenTheInboxShowsIt_ThenTheSuggestedAnswerComesFirstAndIsMarked", async () => {
    await twoTickets();
    const item = within(await card("AI-1: Board")).getByRole("listitem", {
      name: "Question: Which layout?",
    });
    const choices = within(within(item).getByRole("group", { name: "Answers" })).getAllByRole(
      "button",
    );
    // Each answer shows the key that picks it (AI-371).
    expect(choices.map((b) => b.textContent)).toEqual(["1ListSuggested", "2Columns"]);
    expect(within(item).getByRole("list", { name: "Assumptions" }).textContent).toBe(
      "Desktop first",
    );
    expect(within(item).getByLabelText("Your answer")).toBeTruthy();
  });

  it("GivenSeveralQuestions_WhenTheInboxOpens_ThenNoAnswerButtonIsAFilledPrimary", async () => {
    await twoTickets();
    await card("AI-1: Board");
    const answers = screen.getAllByRole("button", { name: "Answer" });
    expect(answers).toHaveLength(2);
    for (const b of answers) expect(b.className).not.toContain("bg-primary");
    // The one primary action on the screen (design.md).
    const primary = screen.getAllByRole("button").filter((b) => b.className.includes("bg-primary"));
    expect(primary.map((b) => b.textContent)).toEqual(["Accept all suggested (2)"]);
    const field = screen.getAllByLabelText("Your answer")[0]!;
    expect(field.getAttribute("name")).toBe("answer");
    expect(field.getAttribute("autocomplete")).toBe("off");
  });

  it("GivenAnUrgentQuestion_WhenTheInboxShowsIt_ThenTheUrgentMarkComesBeforeTheQuestion", async () => {
    await twoTickets("/p/ai/inbox", async (h) => {
      const ticket = await h.service.create("ai", { type: "chore", title: "Keys" }, "andy");
      await askAsRun(h, ticket.id, "run3", [
        { text: "Rotate now?", options: ["Yes", "No"], urgency: "high" },
      ]);
    });
    await card("AI-3: Keys");
    const item = await waitFor(() => {
      const q = question("Rotate now?");
      if (!q) throw new Error("not shown yet");
      return q;
    });
    const line = within(item).getByText("Rotate now?").parentElement!;
    expect(line.textContent).toBe("UrgentRotate now?");
  });

  it("GivenARunsQuestion_WhenAndyClicksAnOption_ThenItIsTheAnswerAndTheQuestionLeavesTheInbox", async () => {
    const h = await twoTickets();
    await card("AI-1: Board");
    // Two tickets, three questions: the header counts tickets (AI-347).
    expect(
      await screen.findByRole("link", { name: "Inbox 2 tickets waiting on you" }),
    ).toBeTruthy();

    await h.user.click(
      within(question("Which layout?") as HTMLElement).getByRole("button", { name: "Columns" }),
    );

    await waitFor(() => expect(question("Which layout?")).toBeNull());
    // AI-1 still has a question open, so it still counts.
    expect(screen.getByRole("link", { name: "Inbox 2 tickets waiting on you" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Needs you 2");
    const [answered] = await h.tracker.listQuestions({ ticketId: h.board.id, status: "answered" });
    expect(answered).toMatchObject({ id: "run1-q1", answer: "Columns", answeredVia: "ui" });
  });

  it("GivenFreeText_WhenAndySubmitsIt_ThenItIsTheAnswer", async () => {
    const h = await twoTickets();
    const item = within(await card("AI-2: Panel")).getByRole("listitem");
    await h.user.type(within(item).getByLabelText("Your answer"), "Ops lead");
    await h.user.click(within(item).getByRole("button", { name: "Answer" }));

    await waitFor(() => expect(question("Who signs off?")).toBeNull());
    const [answered] = await h.tracker.listQuestions({ ticketId: h.panel.id });
    expect(answered).toMatchObject({ status: "answered", answer: "Ops lead" });
  });

  it("GivenACardWithSuggestions_WhenAndyAcceptsAll_ThenEverySuggestedQuestionIsAnswered", async () => {
    const h = await twoTickets();
    await h.user.click(
      within(await card("AI-1: Board")).getByRole("button", { name: "Accept all suggested (2)" }),
    );

    // AI-1's last question answered: it leaves the inbox and, ready now, moves to Ready.
    await waitFor(() => expect(screen.queryByRole("article", { name: "AI-1: Board" })).toBeNull());
    const answers = await h.tracker.listQuestions({ ticketId: h.board.id });
    expect(answers.map((q) => [q.text, q.status, q.answer])).toEqual([
      ["Which layout?", "answered", "List"],
      ["Which colour?", "answered", "Blue"],
    ]);
    expect((await h.tracker.getTicket("ai", h.board.id))?.stage).toBe("ready");
    expect(screen.getByRole("link", { name: "Inbox 1 ticket waiting on you" })).toBeTruthy();
    // A card with no suggestion offers no bulk action.
    expect(
      within(await card("AI-2: Panel")).queryByRole("button", { name: /Accept all/ }),
    ).toBeNull();
  });

  it("GivenOneAnswerFails_WhenAndyAcceptsAll_ThenItStopsAndShowsTheError", async () => {
    const h = renderApp("/all/board");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    const t = await h.service.create("ai", readyStory, "andy");
    const [, second] = await askAsRun(h, t.id, "run1", [
      { text: "First?", suggestedAnswer: "A" },
      { text: "Second?", suggestedAnswer: "B" },
      { text: "Third?", suggestedAnswer: "C" },
    ]);
    await open(h, "/p/ai/inbox");
    const button = within(await card("AI-1: Board")).getByRole("button", {
      name: "Accept all suggested (3)",
    });
    // Answered elsewhere (MCP) after the inbox loaded: answering it again is a conflict.
    await h.service.answer(second?.id ?? "", "B", "mcp", "andy");

    await h.user.click(button);

    expect(await screen.findByRole("alert")).toBeTruthy();
    const byText = Object.fromEntries(
      (await h.tracker.listQuestions({ ticketId: t.id })).map((q) => [q.text, q.status]),
    );
    expect(byText).toEqual({ "First?": "answered", "Second?": "answered", "Third?": "open" });
    expect(question("Third?")).toBeTruthy();
  });

  it("GivenAnAnswerInFlight_WhenTheCardRenders_ThenEveryAnswerControlOnItIsLocked", async () => {
    // Holds answer requests until released, so the test sees the card mid-answer.
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    const h = renderApp("/all/board", {
      beforeFetch: async (req) => {
        if (req.url.endsWith("/answer")) await held;
      },
    });
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    const t = await h.service.create("ai", readyStory, "andy");
    await askAsRun(h, t.id, "run1", [layout, colour]);
    await open(h, "/p/ai/inbox");
    const board = await card("AI-1: Board");

    await h.user.click(within(board).getByRole("button", { name: "Accept all suggested (2)" }));

    // Accept all runs: no single answer can race it (AI-30 review), nor a second accept all.
    const buttons = within(board).getAllByRole("button");
    await waitFor(() => expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true));
    release();
    await waitFor(() => expect(screen.queryByRole("article", { name: "AI-1: Board" })).toBeNull());
    const answers = await h.tracker.listQuestions({ ticketId: t.id });
    expect(answers.map((q) => q.answer)).toEqual(["List", "Blue"]);
  });

  it("GivenADoneTicketWithAQuestion_WhenTheInboxOpens_ThenItIsListedLastUnderStale", async () => {
    await twoTickets("/p/ai/inbox", async (h) => {
      const old = await h.service.create("ai", { type: "chore", title: "Old work" }, "andy");
      await h.service.move("ai", old.id, "done", "andy", { force: true });
      await h.service.ask("ai", old.id, { text: "Still needed?" }, "agent");
    });

    const stale = await screen.findByRole("region", { name: "Stale" });
    expect(within(stale).getByRole("button", { name: "AI-3: Old work" })).toBeTruthy();
    expect(rows().at(-1)).toBe("AI-3: Old work");
    expect(within(await card("AI-3: Old work")).getByText("Done")).toBeTruthy();
  });

  it("GivenAFlaggedTicketWithoutQuestions_WhenTheInboxOpens_ThenItsCardSaysItIsFlagged", async () => {
    const h = renderApp("/all/board");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    const t = await h.service.create("ai", readyStory, "andy");
    await h.service.flag("ai", t.id, "andy");
    await open(h, "/p/ai/inbox");

    const flagged = await card("AI-1: Board");
    expect(within(flagged).getByText(/Flagged for you/)).toBeTruthy();
  });

  it("GivenAllProjects_WhenTheInboxOpens_ThenCardsSitUnderAHeadingPerProjectWithItsCount", async () => {
    const h = await twoTickets("/all/inbox", async (h) => {
      await h.tracker.createProject({ name: "Ops", key: "OPS" });
      const backups = await h.service.create("ops", { type: "chore", title: "Backups" }, "andy");
      await h.service.ask("ops", backups.id, { text: "Daily?", suggestedAnswer: "Yes" }, "agent");
    });

    const ai = await screen.findByRole("region", { name: "AI: Andy Intelligence" });
    const ops = await screen.findByRole("region", { name: "OPS: Ops" });
    expect(within(ai).getByRole("heading").textContent).toBe("AI: Andy Intelligence 2");
    expect(within(ai).getAllByRole("button")).toHaveLength(2);
    expect(within(ops).getByRole("button", { name: "OPS-1: Backups" })).toBeTruthy();

    const backups = await card("OPS-1: Backups");
    await h.user.click(within(backups).getByRole("button", { name: /^Yes/ }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "OPS: Ops" })).toBeNull());
    expect(within(ai).getByRole("heading").textContent).toBe("AI: Andy Intelligence 2");
    expect(screen.getByRole("link", { name: "Inbox 2 tickets waiting on you" })).toBeTruthy();
  });

  it("GivenATicketsOnlyQuestion_WhenItIsAnsweredAndItsRowAndDetailLeave_ThenTheToastStillShows", async () => {
    const h = await twoTickets();
    render(<Toaster />);
    const panel = await card("AI-2: Panel");
    await h.user.click(within(panel).getByRole("button", { name: "Andy" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "AI-2: Panel" })).toBeNull());
    expect(screen.queryByRole("article", { name: "AI-2: Panel" })).toBeNull();
    expect(await screen.findByText("Answered AI-2: Panel")).toBeTruthy();
  });

  it("GivenAnAnswer_WhenTheApiTakesIt_ThenAToastConfirmsItWithoutUndo", async () => {
    const h = await twoTickets();
    render(<Toaster />);
    await h.user.click(
      within(question("Which layout?") as HTMLElement).getByRole("button", { name: "Columns" }),
    );

    // The API can't withdraw an answer, so the toast offers no Undo (AI-371).
    const title = await screen.findByText("Answered AI-1: Board");
    expect(title.parentElement?.textContent).toBe("Answered AI-1: BoardColumns");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("GivenAcceptAll_WhenItFinishes_ThenOneToastSaysHowManyWereAccepted", async () => {
    const h = await twoTickets();
    render(<Toaster />);
    await h.user.click(
      within(await card("AI-1: Board")).getByRole("button", { name: "Accept all suggested (2)" }),
    );

    expect(await screen.findByText("2 suggested answers accepted")).toBeTruthy();
    expect(screen.getAllByText("Answered AI-1: Board")).toHaveLength(1);
  });

  it("GivenThePickedTicketsLastQuestionIsAnswered_WhenItLeaves_ThenTheNextRowIsPicked", async () => {
    const h = await twoTickets();
    await h.user.click(
      within(await card("AI-1: Board")).getByRole("button", { name: "Accept all suggested (2)" }),
    );

    expect(await screen.findByRole("article", { name: "AI-2: Panel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AI-2: Panel" }).getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("GivenAPhone_WhenTheInboxOpens_ThenOneDecisionShowsWithItsPlaceInTheQueue", async () => {
    emulateWidth(true);
    const h = await twoTickets();

    const board = await screen.findByRole("article", { name: "AI-1: Board" });
    expect(screen.getByText("Ticket 1 of 2 · question 1 of 2")).toBeTruthy();
    // One decision: the first question only, and no list of rows.
    expect(within(board).getAllByRole("listitem", { name: /^Question:/ })).toHaveLength(1);
    expect(rows()).toEqual([]);
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);

    await h.user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("article", { name: "AI-2: Panel" })).toBeTruthy();
    expect(screen.getByText("Ticket 2 of 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
  });

  describe("question format (AI-73)", () => {
    const formatted: NewQuestion = {
      text: "Should agent evals in CI (AI-6: Agent evals v1) bill Andy's subscription?",
      context:
        "Agent evals replay fixed tickets to catch regressions. Today nothing runs them. CI needs a way to pay before the workflow lands.",
      choices: [
        { label: "API key", consequence: "Pay per call; needs a new secret." },
        { label: "Subscription", consequence: "No new spend; shares the weekly quota." },
      ],
      options: ["API key", "Subscription"],
      recommendation: { answer: "Subscription", reason: "No new secret, no new bill." },
      suggestedAnswer: "Subscription",
      assumptions: ["Subscription"],
    };

    it("GivenAFormattedQuestion_WhenTheInboxShowsIt_ThenQuestionContextOptionsWithConsequencesThenRecommendation", async () => {
      const h = renderApp("/all/board");
      await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
      const t = await h.service.create("ai", readyStory, "andy", { upNext: true });
      await askAsRun(h, t.id, "run1", [formatted]);
      await open(h, "/p/ai/inbox");

      const item = within(await card("AI-1: Board")).getByRole("listitem", {
        name: `Question: ${formatted.text}`,
      });
      const context = within(item).getByLabelText("Context");
      const answers = within(item).getByRole("list", { name: "Answers" });
      const recommendation = within(item).getByLabelText("Recommendation");
      expect(context.textContent).toBe(formatted.context);
      // The recommended option first, each with what choosing it does.
      expect(
        within(answers)
          .getAllByRole("listitem")
          .map((li) => li.textContent),
      ).toEqual([
        "1SubscriptionRecommendedNo new spend; shares the weekly quota.",
        "2API keyPay per call; needs a new secret.",
      ]);
      expect(recommendation.textContent).toBe(
        "Recommended: Subscription. No new secret, no new bill.",
      );
      // Reading order: line, context, options, recommendation.
      const text = item.textContent ?? "";
      const at = (s: string) => text.indexOf(s);
      expect(at(formatted.text)).toBeLessThan(at(formatted.context!));
      expect(at(formatted.context!)).toBeLessThan(at("Pay per call"));
      expect(at("Pay per call")).toBeLessThan(at("Recommended: Subscription."));

      await h.user.click(within(answers).getByRole("button", { name: /^API key/ }));
      await waitFor(() => expect(question(formatted.text)).toBeNull());
      const [answered] = await h.tracker.listQuestions({ ticketId: t.id });
      expect(answered?.answer).toBe("API key");
    });

    it("GivenAFormattedQuestion_WhenTheTicketPageShowsIt_ThenContextOptionsWithConsequencesAndRecommendation", async () => {
      const h = renderApp("/all/board");
      await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
      const t = await h.service.create("ai", readyStory, "andy");
      await askAsRun(h, t.id, "run1", [formatted]);
      await open(h, "/p/ai/t/AI-1");

      const item = await screen.findByRole(
        "article",
        { name: `Question: ${formatted.text}` },
        PAGE_LOAD,
      );
      expect(within(item).getByLabelText("Context").textContent).toBe(formatted.context);
      const options = within(item).getByRole("list", { name: "Options" });
      expect(
        within(options)
          .getAllByRole("listitem")
          .map((li) => li.textContent),
      ).toEqual([
        "API keyPay per call; needs a new secret.",
        "Subscription (recommended)No new spend; shares the weekly quota.",
      ]);
      expect(within(item).getByLabelText("Recommendation").textContent).toBe(
        "Recommended: Subscription. No new secret, no new bill.",
      );
    });

    it("GivenAQuestionStoredBeforeTheFormat_WhenTheInboxShowsIt_ThenNoContextOrRecommendationAppears", async () => {
      await twoTickets();
      const item = within(await card("AI-1: Board")).getByRole("listitem", {
        name: "Question: Which layout?",
      });
      expect(within(item).queryByLabelText("Context")).toBeNull();
      expect(within(item).queryByLabelText("Recommendation")).toBeNull();
      expect(within(item).getByRole("group", { name: "Answers" })).toBeTruthy();
    });
  });
});
