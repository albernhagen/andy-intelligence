import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** AI-92: M5.8: the warn cap's idle reason on the project settings page. */

describe("dispatch status at the warn cap", () => {
  it("GivenDispatchIdleOnTheWarnCap_WhenTheSettingsPageOpens_ThenItSaysOneAgentTaskAtATime", async () => {
    const h = renderApp("/p/ai/settings");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await h.tracker.updateProject("ai", {
      autoBuild: true,
      buildEnabled: true,
      lastDispatch: { decision: "quota_warn", at: "2026-11-12T08:00:00.000Z" },
    });
    await h.queryClient.invalidateQueries();
    const list = await screen.findByRole("list", { name: "Settings" });

    expect(
      await within(list).findByText(
        "Dispatch: subscription quota is at warn: one agent task at a time across all projects",
      ),
    ).toBeTruthy();
  });
});
