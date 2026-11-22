import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { latestFinishedDay } from "@andy/domain";
import { renderApp } from "@/test/harness";

/** AI-323: the model-written summary at the top of What's new, over the real API in-process. */

const ROUTE = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;

async function opened() {
  const harness = renderApp("/p/ai/whats-new");
  await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  return { harness, day: latestFinishedDay(new Date()), at: new Date().toISOString() };
}

describe("daily summary", () => {
  it("GivenAStoredSummary_WhenWhatsNewOpens_ThenItLeadsLabelledWithItsLinks", async () => {
    const { harness, day, at } = await opened();
    const store = harness.digestSummaries;
    await store.claim("ai", day, 10, at);
    const dispatch = { runId: "run-1", route: ROUTE, inputHash: "a".repeat(64), truncated: false };
    await store.dispatched("ai", day.id, dispatch, at);
    const output = {
      summary: "Andy can read a summary of the day.",
      summaryRefs: { tickets: ["AI-323"], prs: [] },
      lines: [
        {
          heading: "M4: Roadmap",
          epicKey: null,
          text: "What's new leads with it.",
          refs: { tickets: ["AI-323"], prs: [349] },
        },
      ],
    };
    await store.complete("ai", day.id, "run-1", output, at);
    await harness.router.invalidate();

    const card = await screen.findByRole("region", { name: "Summary" });
    expect(within(card).getByText(`Model-written summary of ${day.id} (sonnet)`)).toBeTruthy();
    expect(within(card).getByText(output.summary, { exact: false })).toBeTruthy();
    expect(within(card).getAllByRole("link", { name: "AI-323" })).toHaveLength(2);
    expect(within(card).getByText("#349")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Retry once" })).toBeNull();
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions[0]).toBe("Summary");
  });

  it("GivenAFailedSummary_WhenAndyRetries_ThenItRunsAgainAndSaysWhy", async () => {
    const { harness, day, at } = await opened();
    await harness.digestSummaries.claim("ai", day, 10, at);
    const failure = { reason: "run_failed", detail: "timed out" } as const;
    await harness.digestSummaries.fail("ai", day.id, null, failure, at);
    await harness.router.invalidate();

    const card = await screen.findByRole("region", { name: "Summary" });
    expect(within(card).getByText("No summary: its agent task failed: timed out.")).toBeTruthy();
    await harness.user.click(within(card).getByRole("button", { name: "Retry once" }));
    // Nothing merged or changed yesterday, so the retry stores that instead of starting a task.
    expect(
      await within(card).findByText("No summary: nothing was merged or changed that day."),
    ).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Retry once" })).toBeNull();
  });
});
