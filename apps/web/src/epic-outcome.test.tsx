import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** AI-186: M4.24: Epic outcome field in the epic's panel (ADR-0108). */
describe("epic outcome", () => {
  it("GivenAnEpic_WhenAndyEditsItsOutcome_ThenItIsSavedAndShownAfterAReload", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const epic = await harness.service.create("ai", { type: "epic", title: "Roadmap" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${epic.key}` });
    const { user } = harness;

    const section = await screen.findByRole("region", { name: "Outcome" });
    await user.click(within(section).getByRole("button", { name: "Edit outcome" }));
    await user.type(within(section).getByLabelText("Outcome"), "Andy sees every milestone.");
    await user.click(within(section).getByRole("button", { name: "Save" }));
    await waitFor(async () =>
      expect((await harness.tracker.getTicket("ai", epic.id))?.outcome).toBe(
        "Andy sees every milestone.",
      ),
    );

    await harness.router.invalidate();
    expect(await screen.findByText("Andy sees every milestone.")).toBeTruthy();
  });

  it("GivenAnEpic_WhenItsPanelOpens_ThenItsCriteriaAreLabelledDoneWhen", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const epic = await harness.service.create("ai", { type: "epic", title: "Roadmap" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${epic.key}` });

    // Empty, so it's offered in the Add row (AI-330) under its epic name.
    const add = await screen.findByLabelText("Add a list");
    expect(within(add).getByRole("option", { name: "Done when" })).toBeTruthy();
    expect(within(add).queryByRole("option", { name: "Acceptance criteria" })).toBeNull();
  });

  it("GivenAFeature_WhenItsPanelOpens_ThenThereIsNoOutcome", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const t = await harness.service.create("ai", { type: "feature", title: "Chips" }, "andy");
    await harness.router.navigate({ to: `/p/ai/t/${t.key}` });

    const add = await screen.findByLabelText("Add a list");
    expect(within(add).getByRole("option", { name: "Acceptance criteria" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Outcome" })).toBeNull();
  });
});
