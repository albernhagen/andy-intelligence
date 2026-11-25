import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { MergeMode } from "@andy/contracts";
import { buildReleaseNote } from "@andy/domain";
import { renderApp } from "@/test/harness";
import { dayOf } from "./WhatsNewPage";

/** AI-159: the What's new page over the real API in-process, and its header link. */

const PR = "https://github.com/albernhagen/andy-intelligence/pull";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

async function seeded(path: string) {
  const harness = renderApp(path);
  const { tracker, releaseNotes } = harness;
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const epic = await tracker.createTicket("ai", { type: "epic", title: "M4: Epics" }, "andy");
  const story = await tracker.createTicket(
    "ai",
    { type: "feature", title: "Board by epic", parentId: epic.id },
    "andy",
  );
  await tracker.updateTicket("ai", story.id, { fields: { needsAttention: true } }, "andy");
  const note = (
    number: number,
    body: string,
    mergedAt: string,
    ticketKey: string | null,
    mergedByMode: MergeMode | null = null,
  ) =>
    buildReleaseNote({
      mergedByMode,
      projectId: "ai",
      pr: { number, url: `${PR}/${number}`, title: `PR title ${number}` },
      details: { body, mergedBy: "albernhagen", mergedAt },
      ticket: ticketKey ? { key: ticketKey, title: "Board by epic", risk: null } : null,
      files: [{ path: "docs/features/board.md" }],
      recordedAt: mergedAt,
    });
  await releaseNotes.put(
    note(
      7,
      "What changed: Andy sees the board by epic.\nHow it works: Cards group by parent.\nNeeds you: Try it.",
      hoursAgo(1),
      story.key,
    ),
  );
  await releaseNotes.put(note(8, "No block here.", hoursAgo(50), null, "all-clean"));
  await harness.router.invalidate();
  return { ...harness, epic, story };
}

// jsdom lacks the pointer-capture and scroll APIs Radix Select calls.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

describe("What's new page", () => {
  it("GivenAProjectScreen_WhenAndyClicksWhatsNew_ThenThePageOpens", async () => {
    const harness = await seeded("/p/ai");
    await harness.user.click(await screen.findByRole("link", { name: "What's new" }));
    await waitFor(() => expect(harness.router.state.location.pathname).toBe("/p/ai/whats-new"));
    expect(screen.getByRole("link", { name: "What's new" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("GivenNotesAndAnEpic_WhenThePageOpens_ThenStatusFirstThenOneLinePerChangeByDay", async () => {
    const { story, epic } = await seeded("/p/ai/whats-new");
    const status = await screen.findByRole("region", { name: "Status" });
    const row = within(status).getByRole("row", { name: new RegExp(epic.key) });
    expect(row.textContent).toContain("1 need you");
    expect(within(status).getByText("Needs you 1")).toBeTruthy();

    const today = screen.getByRole("region", { name: dayOf(hoursAgo(1)) });
    expect(within(today).getByText("Andy sees the board by epic.")).toBeTruthy();
    expect(within(today).getByRole("link", { name: story.key })).toBeTruthy();
    expect(within(today).getByRole("link", { name: "PR #7" })).toBeTruthy();
    expect(within(today).getByText("Cards group by parent.")).toBeTruthy();
    expect(within(today).getByRole("link", { name: "Feature: board.md" })).toBeTruthy();

    const older = screen.getByRole("region", { name: dayOf(hoursAgo(50)) });
    expect(within(older).getByText("PR title 8")).toBeTruthy();
    expect(within(older).getByText("No note")).toBeTruthy();
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions.indexOf("Status")).toBeLessThan(regions.indexOf("Changes"));
  });

  it("GivenAMergeModeAndMerges_WhenThePageOpens_ThenTheModeAndWhoMergedEachShow", async () => {
    const harness = await seeded("/p/ai/whats-new");
    await harness.tracker.updateProject("ai", { mergeMode: "manual" });
    await harness.router.invalidate();
    const status = await screen.findByRole("region", { name: "Status" });
    await waitFor(() =>
      expect(within(status).getByLabelText("Merge mode").textContent).toBe("Merge mode manual"),
    );

    const today = screen.getByRole("region", { name: dayOf(hoursAgo(1)) });
    expect(within(today).getByText(/merged by albernhagen/)).toBeTruthy();
    const older = screen.getByRole("region", { name: dayOf(hoursAgo(50)) });
    expect(within(older).getByText(/merged by the mode \(all-clean\)/)).toBeTruthy();
  });

  it("GivenAnEpicFilter_WhenPicked_ThenOnlyItsChanges", async () => {
    const harness = await seeded("/p/ai/whats-new");
    // AI-378: the epic filter is a Radix Select.
    await harness.user.click(await screen.findByRole("combobox", { name: "Epic" }));
    await harness.user.click(await screen.findByRole("option", { name: /^AI-1/ }));
    await waitFor(() => expect(screen.queryByText("PR title 8")).toBeNull());
    expect(screen.getByText("Andy sees the board by epic.")).toBeTruthy();
  });

  it("GivenNothingMerged_WhenThePageOpens_ThenItSaysSo", async () => {
    const harness = renderApp("/p/ai/whats-new");
    await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await harness.router.invalidate();
    expect(await screen.findByText("Nothing merged in the last 14 days.")).toBeTruthy();
  });

  it("GivenAllProjects_WhenTheHeaderShows_ThenNoWhatsNewLink", async () => {
    renderApp("/all/inbox");
    await screen.findByRole("link", { name: "Inbox" });
    expect(screen.queryByRole("link", { name: "What's new" })).toBeNull();
  });
});
