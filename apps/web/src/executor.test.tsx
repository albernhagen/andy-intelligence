import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { readyStory, renderApp } from "@/test/harness";

/** AI-79 (ADR-0089 slice 2): where a ticket's runs execute, in the story panel and settings. */

async function readyTicket() {
  const harness = renderApp();
  await harness.tracker.createProject({ name: "AI", key: "AI" });
  const ticket = await harness.service.create("ai", readyStory, "andy");
  await harness.service.move("ai", ticket.id, "ready", "andy");
  return { harness, ticket };
}

describe("executor controls", () => {
  it("GivenAnActionsTicket_WhenAndyClicksRunLocally_ThenTheOverrideIsStoredAndTheTicketWaitsForTheRunner", async () => {
    const { harness, ticket } = await readyTicket();

    await harness.router.navigate({
      to: "/p/$projectId/t/$ticketRef",
      params: { projectId: "ai", ticketRef: ticket.key },
    });
    expect(await screen.findByText("GitHub Actions")).toBeTruthy();
    await harness.user.click(await screen.findByRole("button", { name: "Run locally" }));

    await screen.findByRole("button", { name: "Run on Actions" });
    expect((await harness.tracker.getTicket("ai", ticket.id))?.overrides.executor).toBe("local");
    // No runner is present, so the override waits for one (ADR-0089).
    expect((await screen.findByRole("status", { name: "Status" })).textContent).toContain(
      "Waiting: local runner away",
    );
  });

  it("GivenTheSettingsPage_WhenAndyPicksTheLocalRunner_ThenTheProjectDefaultIsStored", async () => {
    const { harness } = await readyTicket();

    await harness.router.navigate({ to: "/p/$projectId/settings", params: { projectId: "ai" } });
    await harness.user.selectOptions(
      await screen.findByRole("combobox", { name: "Default executor" }),
      "local",
    );

    await expect.poll(async () => (await harness.tracker.getProject("ai"))?.executor).toBe("local");
  });
});
