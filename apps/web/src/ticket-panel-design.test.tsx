import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { readyStory, renderApp } from "@/test/harness";
import { pick } from "@/test/pick";
import { toast } from "@/components/ui/toast";

/**
 * AI-375: the ticket and epic panels on direction A: no native select or checkbox anywhere in
 * the panel (Move…, How it runs and the force form opened too), and a toast with Undo after each
 * save.
 */

vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/toast")>()),
  toast: vi.fn(() => 1),
}));

async function openPanel(fields: Record<string, unknown>) {
  const h = renderApp();
  await h.tracker.createProject({ name: "AI", key: "AI" });
  const ticket = await h.service.create("ai", { title: "Board", ...fields }, "andy");
  await h.router.navigate({ to: `/p/ai/t/${ticket.key}` });
  const panel = await screen.findByRole("dialog", { name: new RegExp(`^${ticket.key}: `) });
  return { h, ticket, panel };
}

/** Opens every folded part of the panel, so the check sees all its controls. */
async function openEverything(h: ReturnType<typeof renderApp>, panel: HTMLElement) {
  await h.user.click(within(panel).getByRole("button", { name: "Move…" }));
  await h.user.click(within(panel).getByRole("button", { name: "Force move…" }));
  const howItRuns = within(panel).getByRole("group", { name: "How it runs" });
  await h.user.click(howItRuns.querySelector("summary")!);
  await within(howItRuns).findByRole("radiogroup", { name: "Worker" });
}

/** Native selects and boxes a person can use: Radix's hidden form shims (`aria-hidden`) aren't. */
const nativeControls = (root: HTMLElement) =>
  [...root.querySelectorAll("select, input[type=checkbox], input[type=radio]")]
    .filter((el) => el.getAttribute("aria-hidden") !== "true")
    .map((el) => el.outerHTML.slice(0, 80));

describe("the header's PR line", () => {
  async function withPr(state: "open" | "merged") {
    const h = renderApp();
    await h.tracker.createProject({
      name: "AI",
      key: "AI",
      repos: ["albernhagen/andy-intelligence"],
    });
    const ticket = await h.service.create("ai", readyStory, "andy");
    await h.tracker.linkPullRequest(
      "ai",
      ticket.id,
      { number: 88, url: "https://github.com/albernhagen/andy-intelligence/pull/88", state },
      "agent",
    );
    await h.router.navigate({ to: `/p/ai/t/${ticket.key}` });
    const panel = await screen.findByRole("dialog", { name: /^AI-1: / });
    await within(panel).findByRole("status", { name: "Status" });
    return panel;
  }

  it("GivenAnOpenPr_WhenThePanelOpens_ThenTheHeaderSaysItWaitsAndTheRowLinksToIt", async () => {
    const panel = await withPr("open");
    expect(await within(panel).findByText("PR #88 waits for you")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "Open PR #88" })).toBeTruthy();
  });

  it("GivenAMergedPr_WhenThePanelOpens_ThenNeitherTheLineNorTheLinkShows", async () => {
    const panel = await withPr("merged");
    await within(panel).findByRole("region", { name: "Next" });
    expect(within(panel).queryByText(/waits for you/)).toBeNull();
    expect(within(panel).queryByRole("link", { name: /Open PR/ })).toBeNull();
  });
});

describe("ticket and epic panel on the new design", () => {
  it("GivenATicketPanel_WhenEveryPartIsOpen_ThenNoControlIsANativeSelectOrCheckbox", async () => {
    const { h, panel } = await openPanel(readyStory);
    await openEverything(h, panel);

    expect(nativeControls(panel)).toEqual([]);
    expect(within(panel).getByRole("combobox", { name: "Type" })).toBeTruthy();
    expect(within(panel).getByRole("combobox", { name: "Force to" })).toBeTruthy();
  });

  it("GivenAnEpicPanel_WhenEveryPartIsOpen_ThenNoControlIsANativeSelectOrCheckbox", async () => {
    const { h, panel } = await openPanel({ type: "epic", title: "Roadmap" });
    await within(panel).findByRole("region", { name: "Outcome" });
    await openEverything(h, panel);

    expect(nativeControls(panel)).toEqual([]);
  });

  it("GivenATicket_WhenThePanelOpens_ThenTheKeySitsAboveATitleAndTheDecisionLeads", async () => {
    const { panel } = await openPanel(readyStory);

    const heading = within(panel).getByRole("heading", { level: 2 });
    expect(heading.textContent).toMatch(/^AI-1: Board/);
    const next = within(panel).getByRole("region", { name: "Next" });
    expect(next.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(next).getByRole("button", { name: "Move to Ready" })).toBeTruthy();
    expect(await within(next).findByText("Definition of Ready met")).toBeTruthy();
  });

  it("GivenARailField_WhenAndyChangesIt_ThenItSavesAndAToastOffersUndo", async () => {
    const { h, ticket, panel } = await openPanel({ type: "feature" });
    vi.mocked(toast).mockClear();

    await pick(h.user, within(panel).getByRole("combobox", { name: "Size" }), "L · large");

    await waitFor(async () => expect((await h.tracker.getTicket("ai", ticket.id))?.size).toBe("L"));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Saved Size on AI-1" })),
    );
    const { undo } = vi.mocked(toast).mock.calls.at(-1)![0];
    expect(undo).toBeTypeOf("function");

    await undo!();

    await waitFor(async () =>
      expect((await h.tracker.getTicket("ai", ticket.id))?.size).toBeNull(),
    );
    // Undo is itself not undoable: its toast has no Undo, so it can't ping-pong.
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(vi.mocked(toast).mock.calls[1]![0].undo).toBeUndefined();
  });

  it("GivenTwoSavesToOneField_WhenAndyUndoesTheFirst_ThenItRefusesAndKeepsTheLaterEdit", async () => {
    const { h, ticket, panel } = await openPanel(readyStory);
    const group = within(panel).getByRole("group", { name: "How it runs" });
    await h.user.click(group.querySelector("summary")!);
    const overrides = await within(group).findByRole("region", { name: "Overrides" });
    vi.mocked(toast).mockClear();

    // Both write the one `overrides` field: Undo on the first would also drop the second.
    await pick(h.user, within(overrides).getByRole("combobox", { name: "Tier" }), "cheap (pinned)");
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    await pick(h.user, within(overrides).getByRole("combobox", { name: "Autonomy" }), "gated");
    await waitFor(async () =>
      expect((await h.tracker.getTicket("ai", ticket.id))?.overrides).toMatchObject({
        tier: "cheap",
        autonomy: "gated",
      }),
    );
    const firstUndo = vi.mocked(toast).mock.calls[0]![0].undo!;

    expect(() => firstUndo()).toThrow(/changed again since/);

    expect((await h.tracker.getTicket("ai", ticket.id))?.overrides).toMatchObject({
      tier: "cheap",
      autonomy: "gated",
    });
  });
});
