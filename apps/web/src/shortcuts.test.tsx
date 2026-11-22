import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { NewQuestion } from "@andy/contracts";
import { readyStory, renderApp } from "@/test/harness";
import { SEQUENCE_MS, SHORTCUTS, shortcutHandler } from "@/lib/shortcuts";

/** AI-338: Keyboard: move through and act on the inbox and board without the mouse. */

type Harness = ReturnType<typeof renderApp>;

const layout: NewQuestion = { text: "Which layout?", options: ["Columns", "List"] };
const colour: NewQuestion = { text: "Which colour?", options: [], suggestedAnswer: "Blue" };

/** AI-1 with two open questions, then the project inbox. */
async function inbox(): Promise<Harness & { ticketId: string }> {
  const h = renderApp("/all/board");
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const ticket = await h.service.create("ai", readyStory, "andy");
  await h.tracker.askQuestions("ai", ticket.id, [layout, colour], "agent:run1", "run1");
  await h.queryClient.invalidateQueries();
  await h.router.navigate({ href: "/p/ai/inbox" });
  await screen.findByRole("listitem", { name: "Question: Which colour?" });
  return { ...h, ticketId: ticket.id };
}

const question = (text: string) => screen.getByRole("listitem", { name: `Question: ${text}` });
const path = (h: Harness) => h.router.state.location.pathname;

describe("keyboard shortcuts in the inbox", () => {
  it("GivenTheInbox_WhenJAndKArePressed_ThenFocusMovesBetweenQuestions", async () => {
    const { user } = await inbox();
    await user.keyboard("j");
    expect(document.activeElement).toBe(question("Which layout?"));
    await user.keyboard("j");
    expect(document.activeElement).toBe(question("Which colour?"));
    await user.keyboard("j");
    expect(document.activeElement).toBe(question("Which colour?"));
    await user.keyboard("k");
    expect(document.activeElement).toBe(question("Which layout?"));
  });

  it("GivenAFocusedQuestion_WhenAIsPressed_ThenItsAnswerFieldIsFocusedAndEmpty", async () => {
    const { user } = await inbox();
    await user.keyboard("j");
    await user.keyboard("a");
    const field = within(question("Which layout?")).getByRole("textbox", { name: "Your answer" });
    expect(document.activeElement).toBe(field);
    expect((field as HTMLInputElement).value).toBe("");
  });

  it("GivenAFocusedQuestion_WhenANumberIsPressed_ThenThatAnswerIsFocusedButNotChosen", async () => {
    const h = await inbox();
    await h.user.keyboard("j");
    await h.user.keyboard("2");
    expect(document.activeElement).toBe(
      within(question("Which layout?")).getByRole("button", { name: "List" }),
    );
    const open = await h.tracker.listQuestions({ ticketId: h.ticketId });
    expect(open.filter((q) => q.status === "open")).toHaveLength(2);
  });

  it("GivenAFocusedAnswer_WhenEnterIsPressed_ThenItIsChosen", async () => {
    const h = await inbox();
    await h.user.keyboard("j");
    await h.user.keyboard("1");
    await h.user.keyboard("{Enter}");
    await waitFor(async () => {
      const qs = await h.tracker.listQuestions({ ticketId: h.ticketId });
      expect(qs.find((q) => q.text === "Which layout?")?.answer).toBe("Columns");
    });
  });

  it("GivenAFocusedQuestion_WhenEnterIsPressed_ThenItsTicketOpens", async () => {
    const h = await inbox();
    await h.user.keyboard("j");
    await h.user.keyboard("{Enter}");
    await waitFor(() => expect(path(h)).toBe("/p/ai/t/AI-1"));
  });

  it("GivenTypingInTheAnswerField_WhenShortcutKeysAreTyped_ThenTheyAreTypedNotRun", async () => {
    const h = await inbox();
    const field = within(question("Which layout?")).getByRole("textbox", { name: "Your answer" });
    await h.user.click(field);
    await h.user.keyboard("jka1g?gb");
    expect((field as HTMLInputElement).value).toBe("jka1g?gb");
    expect(document.activeElement).toBe(field);
    expect(path(h)).toBe("/p/ai/inbox");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });
});

describe("keyboard shortcuts on the board", () => {
  async function board() {
    const h = renderApp();
    await h.tracker.createProject({ name: "AI", key: "AI" });
    await h.service.create("ai", { ...readyStory, title: "First" }, "andy");
    await h.service.create("ai", { ...readyStory, title: "Second" }, "andy");
    await h.router.navigate({ to: "/p/ai" });
    await screen.findByText("Second");
    return h;
  }
  const cards = () => [...document.querySelectorAll<HTMLElement>("[data-nav-item]")];

  it("GivenTheBoard_WhenJAndKArePressed_ThenFocusMovesBetweenCards", async () => {
    const { user } = await board();
    expect(cards()).toHaveLength(2);
    await user.keyboard("j");
    expect(document.activeElement).toBe(cards()[0]);
    await user.keyboard("j");
    expect(document.activeElement).toBe(cards()[1]);
    await user.keyboard("k");
    expect(document.activeElement).toBe(cards()[0]);
  });

  it("GivenAFocusedCard_WhenEnterIsPressed_ThenItsTicketOpens", async () => {
    const h = await board();
    await h.user.keyboard("j");
    const key = cards()[0]!.dataset.ticket;
    await h.user.keyboard("{Enter}");
    await waitFor(() => expect(path(h)).toBe(`/p/ai/t/${key}`));
  });
});

describe("go-to shortcuts and help", () => {
  async function inProject() {
    const h = renderApp();
    await h.tracker.createProject({ name: "AI", key: "AI" });
    await h.router.navigate({ to: "/p/ai" });
    await screen.findByRole("region", { name: "Backlog" });
    return h;
  }

  it("GivenAProjectInScope_WhenGIIsPressed_ThenItsInboxOpens", async () => {
    const h = await inProject();
    await h.user.keyboard("gi");
    await waitFor(() => expect(path(h)).toBe("/p/ai/inbox"));
  });

  it("GivenAProjectInScope_WhenGRIsPressed_ThenItsRoadmapOpens", async () => {
    const h = await inProject();
    await h.user.keyboard("gr");
    await waitFor(() => expect(path(h)).toBe("/p/ai/roadmap"));
  });

  it("GivenTheInbox_WhenGBIsPressed_ThenTheBoardOpens", async () => {
    const h = await inProject();
    await h.router.navigate({ href: "/p/ai/inbox" });
    await h.user.keyboard("gb");
    await waitFor(() => expect(path(h)).toBe("/p/ai"));
  });

  it("GivenAnyScreen_WhenQuestionMarkIsPressed_ThenEveryShortcutIsListedAndEscCloses", async () => {
    const h = await inProject();
    await h.user.keyboard("?");
    const help = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    for (const s of SHORTCUTS) expect(within(help).getByText(s.keys)).toBeTruthy();
    await h.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    expect(path(h)).toBe("/p/ai");
  });

  it("GivenTheHelpListOpen_WhenOtherShortcutsArePressed_ThenNothingHappensBehindIt", async () => {
    const h = await inProject();
    await h.user.keyboard("?");
    const help = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    await h.user.keyboard("jgi");
    expect(path(h)).toBe("/p/ai");
    expect(help.contains(document.activeElement)).toBe(true);
  });
});

describe("shortcutHandler", () => {
  const key = (k: string, init: KeyboardEventInit = {}) =>
    new KeyboardEvent("keydown", { key: k, cancelable: true, ...init });

  it("GivenGThenALateSecondKey_WhenTheWaitHasPassed_ThenNothingNavigates", () => {
    let t = 0;
    const go = vi.fn();
    const handle = shortcutHandler({ go, toggleHelp: vi.fn() }, () => t);
    handle(key("g"));
    t = SEQUENCE_MS + 1;
    handle(key("i"));
    expect(go).not.toHaveBeenCalled();
  });

  it("GivenAModifierHeld_WhenAShortcutKeyIsPressed_ThenItIsLeftToTheBrowser", () => {
    const toggleHelp = vi.fn();
    const handle = shortcutHandler({ go: vi.fn(), toggleHelp });
    const e = key("?", { metaKey: true });
    handle(e);
    expect(toggleHelp).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});
