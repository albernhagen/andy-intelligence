import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/harness";
import { STATE_KEY } from "@/lib/github-setup";

const posted = vi.hoisted(() => [] as { postUrl: string; manifest: unknown; state: string }[]);
vi.mock("@/lib/github-setup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github-setup")>();
  return {
    ...actual,
    postManifest: (postUrl: string, manifest: unknown, state: string) =>
      posted.push({ postUrl, manifest, state }),
  };
});

/** Settings → GitHub (ADR-0043): connect from the UI, then pick installed repos. */
describe("GitHub settings UI", () => {
  beforeEach(() => {
    posted.length = 0;
    sessionStorage.clear();
  });

  it("GivenNotConnected_WhenAndyClicksConnect_ThenTheManifestIsPostedToGitHubWithAState", async () => {
    const { user } = renderApp("/settings/github");
    await user.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.postUrl).toBe("https://github.com/settings/apps/new");
    expect(posted[0]!.manifest).toMatchObject({ name: "andy-intelligence", public: false });
    expect(sessionStorage.getItem(STATE_KEY)).toBe(posted[0]!.state);
  });

  it("GivenGitHubRedirectsBackWithTheRightState_WhenTheCallbackLoads_ThenGitHubIsConnected", async () => {
    sessionStorage.setItem(STATE_KEY, "s1");
    const { connections } = renderApp("/settings/github/callback?code=abc123&state=s1");
    expect(await screen.findByText("andy-intelligence")).toBeTruthy();
    expect(screen.getByText("albernhagen/andy-intelligence")).toBeTruthy();
    expect((await connections.get())?.appId).toBe("42");
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull();
  });

  it("GivenAForgedCallbackLink_WhenItLoads_ThenNothingIsConnected", async () => {
    sessionStorage.setItem(STATE_KEY, "s1");
    const { connections } = renderApp("/settings/github/callback?code=abc123&state=attacker");
    expect((await screen.findByRole("alert")).textContent).toMatch(/didn.t come from/);
    expect(await connections.get()).toBeNull();
  });

  it("GivenAnInstalledRepo_WhenAndyCreatesAProject_ThenTheRepoIsSuggested", async () => {
    sessionStorage.setItem(STATE_KEY, "s1");
    const { router } = renderApp("/settings/github/callback?code=abc123&state=s1");
    await screen.findByText("Installed on");
    await router.navigate({ to: "/projects" });
    await waitFor(() =>
      expect(
        document.querySelector('#installed-repos option[value="albernhagen/andy-intelligence"]'),
      ).not.toBeNull(),
    );
  });
});
