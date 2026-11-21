import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TicketEvent } from "@andy/contracts";
import { PullRequestLink, waitingPullRequest } from "./PullRequestLink";

/** AI-194: M7.15: Gated PRs from the phone. */

const URL = "https://github.com/albernhagen/andy-intelligence/pull/88";
let n = 0;
const event = (kind: TicketEvent["kind"], data: Record<string, unknown> = {}): TicketEvent => ({
  id: `e${++n}`,
  ticketId: "t1",
  kind,
  actor: "system",
  runId: null,
  body: null,
  data,
  createdAt: "2026-11-20T12:00:00.000Z",
});
const pr = (state: string, url = URL, number = 88) => event("pr_linked", { number, url, state });

describe("waitingPullRequest", () => {
  it("GivenAnOpenLinkedPr_WhenRead_ThenItsNumberAndUrl", () => {
    expect(waitingPullRequest([event("created"), pr("open")])).toEqual({ number: 88, url: URL });
  });

  it.each([
    ["no linked PR", [event("created")]],
    ["a merged PR", [pr("open"), pr("merged")]],
    ["a closed PR", [pr("open"), pr("closed")]],
  ])("GivenTheTicketHas %s_WhenRead_ThenNone", (_label, events) => {
    expect(waitingPullRequest(events)).toBeNull();
  });

  it.each([
    ["another host", "https://evil.example/albernhagen/andy-intelligence/pull/88"],
    ["plain http", "http://github.com/albernhagen/andy-intelligence/pull/88"],
    ["a non-PR page", "https://github.com/albernhagen/andy-intelligence/settings"],
    ["a lookalike host", "https://github.com.evil.example/a/b/pull/1"],
  ])("GivenAUrlOn %s_WhenRead_ThenNone", (_label, url) => {
    expect(waitingPullRequest([pr("open", url)])).toBeNull();
  });

  it("GivenANewerPrAfterAMergedOne_WhenRead_ThenTheNewerOpenOne", () => {
    const newer = URL.replace("/88", "/91");
    expect(waitingPullRequest([pr("merged"), pr("open", newer, 91)])).toEqual({
      number: 91,
      url: newer,
    });
  });
});

describe("PullRequestLink", () => {
  it("GivenAnOpenPr_WhenShown_ThenOpenInGitHubLinksToItInANewTab", () => {
    render(<PullRequestLink events={[pr("open")]} />);
    const link = screen.getByRole("link", { name: "Open in GitHub" });
    expect(link.getAttribute("href")).toBe(URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("PR #88 waits for you")).toBeTruthy();
  });

  it("GivenNoOpenPr_WhenShown_ThenNothing", () => {
    const { container } = render(<PullRequestLink events={[pr("merged")]} />);
    expect(container.innerHTML).toBe("");
  });
});
