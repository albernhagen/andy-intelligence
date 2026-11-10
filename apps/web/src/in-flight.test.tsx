import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { readyStory, renderApp } from "@/test/harness";

/** The in-flight panel on the board (ADR-0080) and the overlap reason on a ticket's status line. */
describe("in-flight view", () => {
  async function withBuildInFlight() {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const building = await harness.service.create(
      "ai",
      { ...readyStory, touches: ["packages/domain/**"] },
      "andy",
    );
    await harness.runs.create({
      projectId: "ai",
      ticketId: building.id,
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: "fast",
      deadline: null,
      prompt: "x",
      maxTurns: 1,
      touches: ["packages/domain/**"],
      reservedAdr: 83,
    });
    return { harness, building };
  }

  it("GivenABuildInFlight_WhenTheBoardOpens_ThenThePanelShowsItsTicketTouchesAndAdrNumber", async () => {
    const { harness, building } = await withBuildInFlight();
    await harness.router.navigate({ to: "/p/ai" });
    const panel = await screen.findByRole("region", { name: "In flight" });
    expect(within(panel).getByText(building.key)).toBeTruthy();
    expect(within(panel).getByText(/Touches: packages\/domain\/\*\*/)).toBeTruthy();
    expect(within(panel).getByText(/ADR-0083/)).toBeTruthy();
  });

  it("GivenNothingInFlight_WhenTheBoardOpens_ThenNoPanel", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByRole("region", { name: "Backlog" });
    expect(screen.queryByRole("region", { name: "In flight" })).toBeNull();
  });

  it("GivenAReadyTicketOverlappingTheBuild_WhenItsPanelOpens_ThenTheStatusSaysWhichTicketItWaitsOn", async () => {
    const { harness, building } = await withBuildInFlight();
    const waiting = await harness.service.create(
      "ai",
      { ...readyStory, title: "Waiting", touches: ["packages/domain/src/runs.ts"] },
      "andy",
    );
    await harness.tracker.updateTicket(
      "ai",
      waiting.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
    await harness.router.navigate({ to: `/p/ai/t/${waiting.key}` });
    const status = await screen.findByRole("status", { name: "Status" });
    await within(status).findByText(`Waiting: overlaps ${building.key} in flight`);
  });
});
