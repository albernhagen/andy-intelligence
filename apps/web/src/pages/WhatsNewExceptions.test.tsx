import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { PAGE_LOAD, renderApp } from "@/test/harness";

/**
 * AI-341: the Digest screen folded into What's new: a "24 hours" window, exceptions first (from
 * the digest read MCP `digest` uses), and the old digest URL opens it.
 */

async function seeded(path: string) {
  const harness = renderApp(path);
  await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const asking = await harness.tracker.createTicket(
    "ai",
    { type: "feature", title: "Asks" },
    "andy",
  );
  await harness.tracker.askQuestion("ai", asking.id, { text: "Which?" }, "andy");
  await harness.router.invalidate();
  return harness;
}

describe("What's new: the digest's exceptions and 24-hour window", () => {
  it("GivenATicketWaitingForAndy_WhenWhatsNewOpens_ThenExceptionsComeFirst", async () => {
    await seeded("/p/ai/whats-new");

    const exceptions = await screen.findByRole("region", { name: "Exceptions" }, PAGE_LOAD);
    expect(within(exceptions).getByText("Waiting for you: Which?")).toBeTruthy();
    expect(within(exceptions).getByRole("link", { name: /Asks/ })).toBeTruthy();
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions[0]).toBe("Exceptions");
  });

  it("GivenTheOldDigestUrl_WhenOpened_ThenWhatsNewOpensOnTheLast24Hours", async () => {
    const harness = await seeded("/p/ai/digest");

    await waitFor(() => expect(harness.router.state.location.pathname).toBe("/p/ai/whats-new"));
    const window = await screen.findByRole("group", { name: "Window" }, PAGE_LOAD);
    expect(
      within(window).getByRole("button", { name: "24 hours" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("GivenNothingWaiting_WhenWhatsNewOpens_ThenNoExceptionsBlock", async () => {
    const harness = renderApp("/p/ai/whats-new");
    await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await harness.router.invalidate();

    await screen.findByRole("group", { name: "Window" }, PAGE_LOAD);
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());
    expect(screen.queryByRole("region", { name: "Exceptions" })).toBeNull();
  });

  it("GivenAProject_WhenAnyScreenShows_ThenNoLinkSaysDigest", async () => {
    await seeded("/p/ai/whats-new");

    await screen.findByRole("group", { name: "Window" }, PAGE_LOAD);
    expect(screen.queryByRole("link", { name: "Digest" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Digest" })).toBeNull();
  });

  it("GivenWhatsNewOpenOn14Days_WhenTheOldDigestUrlIsFollowed_ThenTheWindowSwitchesTo24Hours", async () => {
    const harness = await seeded("/p/ai/whats-new");
    const window = await screen.findByRole("group", { name: "Window" }, PAGE_LOAD);
    expect(
      within(window).getByRole("button", { name: "14 days" }).getAttribute("aria-pressed"),
    ).toBe("true");

    await harness.router.navigate({ href: "/p/ai/digest" });

    await waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "Window" }))
          .getByRole("button", { name: "24 hours" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
  });

  it("GivenTheDigestReadFails_WhenWhatsNewOpens_ThenExceptionsSaysWhatFailedWithARetry", async () => {
    const harness = renderApp("/p/ai/whats-new", {
      beforeFetch: async (request) => {
        if (new URL(request.url).pathname.endsWith("/digest"))
          throw new TypeError("Failed to fetch");
      },
    });
    await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await harness.router.invalidate();

    // A network error shows its own message; the block offers a retry and the page still loads.
    expect(await screen.findByText(/Failed to fetch/, {}, PAGE_LOAD)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Exceptions" })).toBeNull();
    expect(screen.getByRole("group", { name: "Window" })).toBeTruthy();
  });
});
