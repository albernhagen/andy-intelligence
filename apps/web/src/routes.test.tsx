import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { readyStory, renderApp } from "@/test/harness";

/**
 * AI-30: every screen the shell reaches has its own URL. Each test loads one URL directly, as a
 * reload or a pasted link does, and checks that the screen renders and the URL stays.
 */

async function load(path: string) {
  const h = renderApp(path);
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const t = await h.service.create("ai", readyStory, "andy");
  await h.service.ask("ai", t.id, { text: "Which layout?" }, "agent");
  await h.queryClient.invalidateQueries();
  return h;
}

const pathname = (h: Awaited<ReturnType<typeof load>>) => h.router.state.location.pathname;

describe("a URL for every page", () => {
  it.each([
    ["/all/inbox", "Which layout?"],
    ["/p/ai/inbox", "Which layout?"],
    ["/p/ai", "Backlog"],
    ["/all/board", "A board shows one project. Pick one:"],
    ["/p/ai/t/AI-1", "AI-1: Board"],
    ["/projects", "Projects"],
    ["/settings/github", "GitHub"],
  ])("GivenTheUrl %s_WhenLoadedDirectly_ThenItsScreenOpensThere", async (path, text) => {
    const h = await load(path);
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
    expect(pathname(h)).toBe(path);
  });

  it("GivenTheGitHubCallbackUrl_WhenLoadedDirectly_ThenItsScreenOpensThere", async () => {
    const h = await load("/settings/github/callback?code=x&state=y");
    expect(await screen.findByText(/didn.t come from your "Connect GitHub" click/)).toBeTruthy();
    expect(pathname(h)).toBe("/settings/github/callback");
  });

  it("GivenARememberedProject_WhenTheBaseUrlLoads_ThenItRedirectsToThatProjectsInbox", async () => {
    window.localStorage.setItem("andy.scope", "p:ai");
    const h = await load("/");
    await waitFor(() => expect(pathname(h)).toBe("/p/ai/inbox"));
    expect(await screen.findByText("Which layout?")).toBeTruthy();
  });

  it("GivenAllProjectsUrl_WhenLoadedDirectly_ThenItRedirectsToTheAllProjectsInbox", async () => {
    const h = await load("/all");
    await waitFor(() => expect(pathname(h)).toBe("/all/inbox"));
  });
});
