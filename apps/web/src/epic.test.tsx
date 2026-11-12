import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";
import { formatEpicRollup } from "@/components/EpicChildren";

const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;

/** The epic's stories in the story panel (AI-85: M4.1: Epic panel: children and roll-ups). */
describe("epic panel", () => {
  async function withEpic() {
    const harness = renderApp();
    const { tracker, runs } = harness;
    await tracker.createProject({ name: "AI", key: "AI" });
    const epic = await tracker.createTicket("ai", { title: "Epics", type: "epic" }, "andy");
    const first = await tracker.createTicket(
      "ai",
      { title: "Epic panel", type: "feature", size: "M", parentId: epic.id },
      "andy",
    );
    const outside = await tracker.createTicket("ai", { title: "Outside" }, "andy");
    const second = await tracker.createTicket(
      "ai",
      {
        title: "Board grouping",
        type: "feature",
        size: "S",
        parentId: epic.id,
        blockedBy: [first.id, outside.id],
      },
      "andy",
    );
    const dropped = await tracker.createTicket(
      "ai",
      { title: "Dropped", parentId: epic.id },
      "andy",
    );
    await tracker.updateTicket("ai", second.id, { rank: "0" }, "andy");
    await tracker.updateTicket(
      "ai",
      first.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );
    await tracker.updateTicket(
      "ai",
      dropped.id,
      { stage: { to: "cancelled", forced: true, reason: null } },
      "andy",
    );
    const run = await runs.create({
      projectId: "ai",
      ticketId: first.id,
      step: "build",
      route,
      tier: null,
    });
    await runs.update(run.id, { status: "succeeded", costUsd: 2.5 }, ["queued"]);
    return { harness, epic, outside };
  }

  it("GivenAnEpic_WhenItsPanelOpens_ThenStoriesAreInDependencyOrderWithStageSizeAndOpenBlockers", async () => {
    const { harness, epic, outside } = await withEpic();
    await harness.router.navigate({ to: `/p/ai/t/${epic.key}` });

    const stories = await screen.findByRole("region", { name: "Stories" });
    const items = await within(stories).findAllByRole("listitem");
    expect(items.map((li) => within(li).getByRole("link").textContent)).toEqual([
      "AI-2: Epic panel",
      "AI-4: Board grouping",
      "AI-5: Dropped",
    ]);
    expect(within(items[0]!).getByText("Done")).toBeTruthy();
    expect(within(items[0]!).getByText("M")).toBeTruthy();
    expect(within(items[1]!).getByText(`Blocked by ${outside.key}`)).toBeTruthy();
    expect(within(items[2]!).getByText("Cancelled")).toBeTruthy();
  });

  it("GivenAnEpic_WhenItsPanelOpens_ThenProgressExcludesCancelledAndCostIsSummed", async () => {
    const { harness, epic } = await withEpic();
    await harness.router.navigate({ to: `/p/ai/t/${epic.key}` });

    const progress = await screen.findByLabelText("Epic progress");
    expect(progress.textContent).toBe("1 of 2 done · Cost ~$2.50 (estimate)");
  });

  it("GivenAFeature_WhenItsPanelOpens_ThenNoStoriesSection", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const t = await harness.tracker.createTicket("ai", { title: "Plain", type: "feature" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${t.key}` });

    await screen.findByRole("region", { name: "Questions" });
    expect(screen.queryByRole("region", { name: "Stories" })).toBeNull();
  });

  it("GivenAPartialRollUp_WhenFormatted_ThenTheCostSaysPartial", () => {
    const line = formatEpicRollup({
      progress: { done: 3, total: 60 },
      cost: { estimatedCostUsd: 12, completedRuns: 40, unknownRuns: 0 },
      partial: true,
    });
    expect(line).toBe("3 of 60 done · Cost ~$12.00 (estimate, partial)");
  });

  it("GivenOnlyUnknownCosts_WhenFormatted_ThenCostUnknown", () => {
    const line = formatEpicRollup({
      progress: { done: 0, total: 1 },
      cost: { estimatedCostUsd: 0, completedRuns: 2, unknownRuns: 2 },
      partial: false,
    });
    expect(line).toBe("0 of 1 done · Cost unknown");
  });
});
