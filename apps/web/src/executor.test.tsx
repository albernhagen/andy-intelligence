import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { PAGE_LOAD, readyStory, renderApp } from "@/test/harness";

/** AI-79 (ADR-0089 part 2): where a ticket's runs execute, in the ticket panel and settings. */

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
    // AI-375: every choice as an option card, the project default picked until Andy picks one.
    const runsOn = await screen.findByRole("radiogroup", { name: "Runs on" }, PAGE_LOAD);
    const useDefault = within(runsOn).getByRole("radio", { name: /^Use project default/ });
    expect(useDefault.getAttribute("aria-checked")).toBe("true");
    expect(useDefault.textContent).toContain("Now GitHub Actions, from the project.");
    await harness.user.click(within(runsOn).getByRole("radio", { name: /^Local runner/ }));

    await waitFor(async () =>
      expect((await harness.tracker.getTicket("ai", ticket.id))?.overrides.executor).toBe("local"),
    );
    await waitFor(() =>
      expect(
        within(runsOn)
          .getByRole("radio", { name: /^Local runner/ })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
    // No runner is present, so the override waits for one (ADR-0089).
    expect((await screen.findByRole("status", { name: "Status" })).textContent).toContain(
      "Waiting: local runner away",
    );
  });

  it("GivenTheSettingsPage_WhenAndyPicksTheLocalRunner_ThenTheProjectDefaultIsStored", async () => {
    const { harness } = await readyTicket();

    await harness.router.navigate({
      to: "/p/$projectId/settings",
      params: { projectId: "ai" },
      hash: "defaults",
    });
    const picker = await screen.findByRole("radiogroup", { name: "Default executor" }, PAGE_LOAD);
    await harness.user.click(within(picker).getByRole("radio", { name: /^Local runner/ }));

    await expect.poll(async () => (await harness.tracker.getProject("ai"))?.executor).toBe("local");
  });
});
