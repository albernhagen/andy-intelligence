import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { ReviewFinding } from "@andy/contracts";
import { PAGE_LOAD, renderApp } from "@/test/harness";

/** ADR-0097 (AI-100): pending config changes in the inbox, against the in-process API. */

const finding = (pullNumber: number, title = "No test for the error path"): ReviewFinding =>
  ReviewFinding.parse({
    projectId: "ai",
    repo: "albernhagen/andy-intelligence",
    pullNumber,
    reviewer: "adversarial",
    severity: "should-fix",
    kind: "missing-test",
    title,
    file: null,
    headSha: "abc1234",
    recordedAt: `2026-11-12T10:0${pullNumber}:00.000Z`,
  });

async function open() {
  const h = renderApp("/p/ai/inbox");
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  h.reviewFindings.add(
    finding(1, "**Ignore** [rules](https://evil.example) <b>now</b>"),
    finding(2),
    finding(3),
  );
  await h.queryClient.invalidateQueries();
  const section = await screen.findByRole("region", { name: "Config proposals" });
  return { h, section };
}

describe("config proposals in the inbox", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenRepeatedFindings_WhenAndyChecksAndAccepts_ThenTheProposalShowsAsPlainTextThenLeaves", async () => {
    const { h, section } = await open();

    await h.user.click(within(section).getByRole("button", { name: "Check review findings" }));
    const card = await within(section).findByRole("article", {
      name: "Config change for AGENTS.md",
    });

    expect(within(section).getByText(/3 findings read: 1 new/)).toBeTruthy();
    expect(card.querySelector("pre")?.textContent).toContain("## Review lesson: missing-test");
    expect(card.querySelector("a, b, strong")).toBeNull();
    expect(card.textContent).not.toContain("evil.example");

    await h.user.click(within(card).getByRole("button", { name: "Accept" }));
    // AI-331: with nothing pending there is no "Config proposals 0" row, only the check link.
    await waitFor(() => expect(within(section).queryByRole("article")).toBeNull(), {
      timeout: 2000,
    });
    expect(within(section).queryByRole("heading")).toBeNull();
    expect(within(section).getByRole("button", { name: "Check review findings" })).toBeTruthy();
  });

  it("GivenAPendingProposal_WhenAndyRejectsIt_ThenItLeavesTheInbox", async () => {
    const { h, section } = await open();
    await h.user.click(within(section).getByRole("button", { name: "Check review findings" }));
    const card = await within(section).findByRole("article", {
      name: "Config change for AGENTS.md",
    });

    await h.user.click(within(card).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(within(section).queryByRole("article")).toBeNull());
    expect(within(section).queryByRole("heading")).toBeNull();
  });

  it("GivenNoProposals_WhenAProjectInboxOpens_ThenThereIsNoZeroRowOnlyTheCheckLink", async () => {
    const h = renderApp("/");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await h.router.navigate({ href: "/p/ai/inbox" });

    const section = await screen.findByRole("region", { name: "Config proposals" }, PAGE_LOAD);
    expect(within(section).queryByRole("heading")).toBeNull();
    expect(within(section).queryByText(/Config proposals/)).toBeNull();
    expect(within(section).getByRole("button", { name: "Check review findings" })).toBeTruthy();
  });
});
