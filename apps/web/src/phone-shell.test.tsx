import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";
import { PHONE_QUERY } from "@/lib/use-phone";

/** AI-173: M7.3: Phone shell — bottom navigation below `sm` (design.md "Phone"). */

function emulateWidth(phone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: phone && query === PHONE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

async function project(path: string) {
  const harness = renderApp(path);
  await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await harness.router.invalidate();
  return harness;
}

describe("phone shell", () => {
  beforeEach(() => emulateWidth(true));
  afterEach(() => vi.unstubAllGlobals());

  it("GivenAPhoneScreen_WhenTheShellRenders_ThenTheMainScreensAreInABottomBar", async () => {
    await project("/p/ai/inbox");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Board" }).getAttribute("href")).toBe("/p/ai");
    expect(within(nav).getByRole("link", { name: "Inbox" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Dashboards" })).toBeTruthy();
    expect(within(nav).queryByRole("link", { name: "Settings" })).toBeNull();
    expect(within(nav).getByRole("button", { name: "More" })).toBeTruthy();
  });

  it("GivenAPhoneScreen_WhenAndyOpensMore_ThenTheOtherScreensAreThereAndOpen", async () => {
    const harness = await project("/p/ai/inbox");
    await harness.user.click(await screen.findByRole("button", { name: "More" }));
    const menu = await screen.findByRole("menu");
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((i) => i.textContent);
    expect(items).toEqual([
      "Roadmap",
      "Work",
      "What's new",
      "Project settings",
      "GitHub",
      "Local runners",
      "Models",
    ]);
    await harness.user.click(within(menu).getByRole("menuitem", { name: "GitHub" }));
    await waitFor(() => expect(harness.router.state.location.pathname).toBe("/settings/github"));
  });

  it("GivenADesktopScreen_WhenTheShellRenders_ThenNavigationStaysInTheHeader", async () => {
    emulateWidth(false);
    await project("/p/ai/inbox");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Roadmap" })).toBeTruthy();
    expect(within(nav).queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });
});
