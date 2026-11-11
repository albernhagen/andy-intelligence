import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { NewQuestion } from "@andy/contracts";
import { readyStory, renderApp } from "@/test/harness";

/** AI-30: Inbox v2: questions grouped by ticket, one-click suggested answers. */

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

const card = (name: string) => screen.findByRole("article", { name });
const question = (text: string) => screen.queryByRole("listitem", { name: `Question: ${text}` });

describe("inbox v2", () => {
  it("GivenQuestionsOnSeveralTickets_WhenTheInboxOpens_ThenOneCardPerTicketHoldsItsQuestions", async () => {
    await twoTickets();
    const board = await card("AI-1: Board");
    const panel = await card("AI-2: Panel");

    expect(within(board).getAllByRole("listitem", { name: /^Question:/ })).toHaveLength(2);
    expect(within(board).getByRole("listitem", { name: "Question: Which layout?" })).toBeTruthy();
    expect(within(panel).getByRole("listitem", { name: "Question: Who signs off?" })).toBeTruthy();
    expect(within(board).getByText("Feature")).toBeTruthy();
    expect(within(board).getByText("Backlog")).toBeTruthy();
    expect(within(board).getByRole("link", { name: "AI-1: Board" }).getAttribute("href")).toBe(
      "/p/ai/t/AI-1",
    );
  });

  it("GivenATicketWhoseOnlyGapIsQuestions_WhenTheInboxOpens_ThenItsCardComesFirst", async () => {
    await twoTickets();
    await card("AI-1: Board");
    const names = screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"));
    expect(names).toEqual(["AI-1: Board", "AI-2: Panel"]);
  });

  it("GivenAQuestion_WhenTheInboxShowsIt_ThenTheSuggestedAnswerComesFirstAndIsMarked", async () => {
    await twoTickets();
    const item = within(await card("AI-1: Board")).getByRole("listitem", {
      name: "Question: Which layout?",
    });
    const choices = within(within(item).getByRole("group", { name: "Answers" })).getAllByRole(
      "button",
    );
    expect(choices.map((b) => b.textContent)).toEqual(["ListSuggested", "Columns"]);
    expect(within(item).getByRole("list", { name: "Assumptions" }).textContent).toBe(
      "Desktop first",
    );
    expect(within(item).getByLabelText("Your answer")).toBeTruthy();
  });

  it("GivenARunsQuestion_WhenAndyClicksAnOption_ThenItIsTheAnswerAndTheQuestionLeavesTheInbox", async () => {
    const h = await twoTickets();
    await card("AI-1: Board");
    expect(await screen.findByRole("link", { name: "Needs you 3" })).toBeTruthy();

    await h.user.click(
      within(question("Which layout?") as HTMLElement).getByRole("button", { name: "Columns" }),
    );

    await waitFor(() => expect(question("Which layout?")).toBeNull());
    expect(screen.getByRole("link", { name: "Needs you 2" })).toBeTruthy();
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
    expect(screen.getByRole("link", { name: "Needs you 1" })).toBeTruthy();
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
    expect(within(stale).getByRole("article", { name: "AI-3: Old work" })).toBeTruthy();
    expect(within(stale).getByText("Done")).toBeTruthy();
    const names = screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"));
    expect(names.at(-1)).toBe("AI-3: Old work");
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
    expect(within(ai).getByRole("heading").textContent).toBe("AI: Andy Intelligence 3");
    expect(within(ai).getAllByRole("article")).toHaveLength(2);
    expect(within(ops).getByRole("article", { name: "OPS-1: Backups" })).toBeTruthy();

    await h.user.click(within(ops).getByRole("button", { name: /^Yes/ }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "OPS: Ops" })).toBeNull());
    expect(within(ai).getByRole("heading").textContent).toBe("AI: Andy Intelligence 3");
    expect(screen.getByRole("link", { name: "Needs you 3" })).toBeTruthy();
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
        "SubscriptionRecommendedNo new spend; shares the weekly quota.",
        "API keyPay per call; needs a new secret.",
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

      const item = await screen.findByRole("article", { name: `Question: ${formatted.text}` });
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
