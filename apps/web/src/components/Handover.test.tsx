import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** AI-385: open PRs and next up on What's new, from the digest read MCP `digest` uses. */

const ROUTE = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;
const PR = "https://github.com/albernhagen/andy-intelligence/pull/41";

async function seeded() {
  const harness = renderApp("/p/ai/whats-new");
  const { tracker, runs } = harness;
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const review = await tracker.createTicket(
    "ai",
    { type: "feature", title: "<b>Kept</b> change" },
    "andy",
  );
  const run = await runs.create({
    projectId: "ai",
    ticketId: review.id,
    step: "build",
    route: ROUTE,
    tier: null,
  });
  await runs.update(
    run.id,
    {
      status: "succeeded",
      links: { pullRequest: PR },
      mergeMode: "low-risk",
      mergeVerdict: "wait",
      verdictReasons: ["kept_path"],
    },
    ["queued"],
  );
  await tracker.linkPullRequest("ai", review.id, { number: 41, url: PR, state: "open" }, "system");
  await tracker.updateTicket(
    "ai",
    review.id,
    { stage: { to: "ready_for_review", forced: true, reason: null } },
    "andy",
  );
  const next = await tracker.createTicket(
    "ai",
    {
      type: "feature",
      title: "Next one",
      body: "Andy wants it.",
      acceptanceCriteria: ["The system shall do it."],
      size: "S",
      sizeReason: "small",
    },
    "andy",
  );
  await tracker.updateTicket(
    "ai",
    next.id,
    { stage: { to: "ready", forced: true, reason: null } },
    "andy",
  );
  await harness.router.invalidate();
  return { review, next };
}

describe("handover on What's new", () => {
  it("GivenAWaitingPr_WhenWhatsNewOpens_ThenOpenPrsShowsItsWaitReasonAndLinksThePr", async () => {
    const { review } = await seeded();

    const prs = await screen.findByRole("region", { name: "Open PRs" });
    expect(within(prs).getByText(/Kept<\/b> change/)).toBeTruthy();
    expect(
      within(prs)
        .getByRole("link", { name: /PR #41/ })
        .getAttribute("href"),
    ).toBe(PR);
    expect(within(prs).getByText("Waits")).toBeTruthy();
    expect(
      within(prs).getByText(
        "Waits for Andy: it changes a path on his kept list, which only he merges",
      ),
    ).toBeTruthy();
    expect(within(prs).getByRole("link", { name: new RegExp(review.key) })).toBeTruthy();
  });

  it("GivenAReadyTicketAndNoExecutor_WhenWhatsNewOpens_ThenNextUpListsItAndWhyNothingStarts", async () => {
    const { next } = await seeded();

    const nextUp = await screen.findByRole("region", { name: "Next up" });
    const items = within(nextUp).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]!).getByText("Next")).toBeTruthy();
    expect(within(items[0]!).getByRole("link", { name: new RegExp(next.key) })).toBeTruthy();
    // The harness has no executor, so that is the first reason nothing starts.
    expect(within(nextUp).getByText(/^Nothing starts on its own: /)).toBeTruthy();
  });

  it("GivenNoOpenPrs_WhenWhatsNewOpens_ThenNoOpenPrsBlockButNextUpStillShows", async () => {
    const harness = renderApp("/p/ai/whats-new");
    await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await harness.router.invalidate();

    const nextUp = await screen.findByRole("region", { name: "Next up" });
    expect(within(nextUp).getByText("Nothing starts on its own", { exact: false })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Open PRs" })).toBeNull();
  });
});
