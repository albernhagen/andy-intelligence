import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { PAGE_LOAD, readyStory, renderApp } from "@/test/harness";

/**
 * The in-flight view (ADR-0080): a running build's branch and touches on its ticket's agent task
 * row (the board's box was removed, AI-342), and the overlap reason on a ticket's status line.
 */
describe("in-flight view", () => {
  async function withBuildInFlight() {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const building = await harness.service.create(
      "ai",
      { ...readyStory, touches: ["packages/domain/**"] },
      "andy",
    );
    const run = await harness.runs.create({
      projectId: "ai",
      ticketId: building.id,
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: "fast",
      deadline: null,
      prompt: "x",
      maxTurns: 1,
      // The run holds the ticket's touches plus its approved plan's files (`runTouches`).
      touches: ["packages/domain/**", "apps/web/src/plan-file.ts"],
      reservedAdr: 83,
    });
    return { harness, building, run };
  }

  it("GivenABuildInFlight_WhenItsTicketPanelOpens_ThenItsAgentTaskShowsBranchTouchesAndAdr", async () => {
    const { harness, building, run } = await withBuildInFlight();
    await harness.router.navigate({ to: `/p/ai/t/${building.key}` });

    const activity = await screen.findByRole("region", { name: "Activity" }, PAGE_LOAD);
    expect(
      await within(activity).findByText(`branch agent/${building.key}/${run.id}`),
    ).toBeTruthy();
    expect(
      within(activity).getByText(
        "Touches: packages/domain/**, apps/web/src/plan-file.ts · ADR-0083 reserved",
      ),
    ).toBeTruthy();
  });

  it("GivenABuildInFlight_WhenTheBoardOpens_ThenThereIsNoInFlightBox", async () => {
    const { harness, building } = await withBuildInFlight();
    await harness.router.navigate({ to: "/p/ai" });

    await screen.findByRole("link", { name: new RegExp(building.key) }, PAGE_LOAD);
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
