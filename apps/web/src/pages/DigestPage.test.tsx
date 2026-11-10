import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** AI-70: the digest page over the real API in-process, and its header link. */

const ROUTE = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;

async function seeded(path: string) {
  const harness = renderApp(path);
  const { tracker, runs } = harness;
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const asking = await tracker.createTicket("ai", { type: "feature", title: "Asks" }, "andy");
  await tracker.askQuestion("ai", asking.id, { text: "Which?" }, "andy");
  const shipped = await tracker.createTicket("ai", { type: "feature", title: "Ships" }, "andy");
  const url = "https://github.com/o/r/pull/3";
  const run = await runs.create({
    projectId: "ai",
    ticketId: shipped.id,
    step: "build",
    route: ROUTE,
    tier: null,
  });
  const endedAt = new Date().toISOString();
  await runs.update(
    run.id,
    { status: "succeeded", endedAt, costUsd: 1.5, links: { pullRequest: url } },
    ["queued"],
  );
  await tracker.linkPullRequest("ai", shipped.id, { number: 3, url, state: "merged" }, "system");
  await harness.router.invalidate();
  return harness;
}

describe("digest page", () => {
  it("GivenAProjectScreen_WhenAndyClicksDigest_ThenTheDigestPageOpens", async () => {
    const harness = await seeded("/p/ai");
    await harness.user.click(await screen.findByRole("link", { name: "Digest" }));
    await waitFor(() => expect(harness.router.state.location.pathname).toBe("/p/ai/digest"));
    expect(screen.getByRole("link", { name: "Digest" }).getAttribute("aria-current")).toBe("page");
  });

  it("GivenActivity_WhenTheDigestOpens_ThenSectionsInOrderWithReasonsAndCost", async () => {
    await seeded("/p/ai/digest");
    const exceptions = await screen.findByRole("region", { name: "Exceptions" });
    expect(within(exceptions).getByText("Waiting for you: 1 question")).toBeTruthy();
    const merged = screen.getByRole("region", { name: "Merged" });
    expect(within(merged).getByRole("link", { name: "PR #3" })).toBeTruthy();
    expect(within(merged).getByText("$1.50")).toBeTruthy();
    const order = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(order).toEqual(["Exceptions", "Merged", "Totals"]);
    expect(screen.getByRole("region", { name: "Totals" }).textContent).toContain("1 merged");
  });

  it("GivenAQuietProject_WhenTheDigestOpens_ThenOneLine", async () => {
    const harness = renderApp("/p/ai/digest");
    await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await harness.router.invalidate();
    expect(await screen.findByText("AI digest · last 24 hours: nothing happened.")).toBeTruthy();
  });

  it("GivenAllProjects_WhenTheHeaderShows_ThenNoDigestLink", async () => {
    renderApp("/all/inbox");
    await screen.findByRole("link", { name: "Inbox" });
    expect(screen.queryByRole("link", { name: "Digest" })).toBeNull();
  });
});
