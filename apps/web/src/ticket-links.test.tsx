import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** Readable ticket links (AI-7): the URL holds the ticket key, e.g. /p/ai/t/AI-1. */

describe("ticket links", () => {
  async function seeded() {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { type: "story", title: "Board" }, "andy");
    return { harness, ticket };
  }

  it("GivenATicketKeyUrl_WhenOpened_ThenTheTicketIsShown", async () => {
    const { harness } = await seeded();
    await harness.router.navigate({ to: "/p/ai/t/AI-1" });
    expect(await screen.findByRole("heading", { name: "AI-1: Board" })).toBeTruthy();
  });

  it("GivenAnOldIdUrl_WhenOpened_ThenTheTicketIsShownAndTheUrlUsesTheKey", async () => {
    const { harness, ticket } = await seeded();
    await harness.router.navigate({ to: `/p/ai/t/${ticket.id}` });
    expect(await screen.findByRole("heading", { name: "AI-1: Board" })).toBeTruthy();
    await waitFor(() => expect(harness.router.state.location.pathname).toBe("/p/ai/t/AI-1"));
  });

  it("GivenAKeyUnderAnotherProjectsPath_WhenOpened_ThenTheUrlSwitchesToTheTicketsProject", async () => {
    const { harness } = await seeded();
    await harness.tracker.createProject({ name: "Other", key: "OT" });
    await harness.router.navigate({ to: "/p/ot/t/AI-1" });
    expect(await screen.findByRole("heading", { name: "AI-1: Board" })).toBeTruthy();
    await waitFor(() => expect(harness.router.state.location.pathname).toBe("/p/ai/t/AI-1"));
  });

  it("GivenAnUnknownKey_WhenOpened_ThenNotFoundIsShown", async () => {
    const { harness } = await seeded();
    await harness.router.navigate({ to: "/p/ai/t/AI-99" });
    expect(await screen.findByText(/not found/i)).toBeTruthy();
  });

  it("GivenTheBoard_WhenRendered_ThenTicketLinksUseTheKey", async () => {
    const { harness } = await seeded();
    await harness.router.navigate({ to: "/p/ai" });
    const link = await screen.findByRole("link", { name: /Board/ });
    expect(link.getAttribute("href")).toBe("/p/ai/t/AI-1");
  });
});
