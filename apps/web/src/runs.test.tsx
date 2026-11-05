import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_ROUTE } from "@andy/domain";
import { renderApp } from "@/test/harness";
import { RUN_POLL_MS, runsRefetchInterval } from "@/lib/queries";
import { formatCost } from "@/components/Runs";

/** Story panel → runs in the activity timeline (M1.6a: Claude Code executor), in-process API. */

const REPO = "albernhagen/andy-intelligence";

async function setup() {
  const harness = renderApp("/", { githubConnected: true });
  await harness.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const ticket = await harness.service.create("ai", { type: "feature", title: "Board" }, "andy");
  const queueRun = (ticketId = ticket.id) =>
    harness.runs.create({
      projectId: "ai",
      ticketId,
      step: "refine",
      route: DEFAULT_ROUTE,
      tier: null,
      deadline: null,
      prompt: "refine it",
      maxTurns: 10,
    });
  const open = async (ticketId = ticket.id) => {
    await harness.router.navigate({ to: `/p/ai/t/${ticketId}` });
    return screen.findByRole("region", { name: "Activity" });
  };
  return { ...harness, ticket, queueRun, open };
}

describe("runs UI", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("GivenAConnectedProject_WhenAndyStartsARefineRun_ThenTheQueuedRunIsListedWithItsLog", async () => {
    const { user, open, runs, ticket } = await setup();
    const section = await open();
    await user.click(await within(section).findByRole("button", { name: "Start refine run" }));

    expect(await within(section).findByText("queued")).toBeTruthy();
    expect(within(section).getByText("sonnet")).toBeTruthy();
    const log = within(section).getByRole("link", { name: "Run log" });
    expect(log.getAttribute("href")).toMatch(
      /^https:\/\/github\.com\/albernhagen\/.+\/actions\/runs\//,
    );
    expect(log.getAttribute("target")).toBe("_blank");
    expect(log.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      within(section).getByRole("button", { name: "Start refine run" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(await runs.listForTicket("ai", ticket.id)).toHaveLength(1);
  });

  it("GivenARunInFlightOnAnotherTicket_WhenAndyStartsARun_ThenTheConflictIsShown", async () => {
    const harness = await setup();
    await harness.queueRun();
    const other = await harness.service.create("ai", { type: "chore", title: "Other" }, "andy");
    const section = await harness.open(other.id);

    await harness.user.click(
      await within(section).findByRole("button", { name: "Start refine run" }),
    );

    expect((await within(section).findByRole("alert")).textContent).toMatch(
      /already has a run in flight/,
    );
  });

  it("GivenASucceededRunWithHtmlInItsSummary_WhenViewed_ThenTheSummaryRendersAsPlainText", async () => {
    const harness = await setup();
    const run = await harness.queueRun();
    const summary = 'Refined.\n<img src=x onerror="window.pwned=1">';
    await harness.runs.update(
      run.id,
      {
        status: "succeeded",
        endedAt: new Date().toISOString(),
        summary,
        tokensIn: 1200,
        tokensOut: 300,
        costUsd: 0.02,
        costIsEstimate: true,
      },
      ["queued"],
    );
    const section = await harness.open();

    const text = await within(section).findByText(/onerror/);
    expect(text.textContent).toBe(summary);
    expect(section.querySelector("img")).toBeNull();
    expect(within(section).getByText("succeeded")).toBeTruthy();
    expect(within(section).getByText(/~\$0\.02 \(estimate\)/)).toBeTruthy();
    expect(
      within(section).getByRole("button", { name: "Start refine run" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("GivenAnAutomaticRetry_WhenViewed_ThenItIsMarkedAsARetry", async () => {
    const { open, runs, ticket } = await setup();
    const first = await runs.create({
      projectId: "ai",
      ticketId: ticket.id,
      step: "refine",
      route: DEFAULT_ROUTE,
      tier: null,
      deadline: null,
      prompt: "refine it",
      maxTurns: 10,
    });
    await runs.create({
      projectId: "ai",
      ticketId: ticket.id,
      step: "refine",
      route: DEFAULT_ROUTE,
      tier: null,
      deadline: null,
      prompt: "refine it",
      maxTurns: 10,
      attempt: 2,
      retryOf: first.id,
    });
    const section = await open();
    expect(await within(section).findByText("retry 2")).toBeTruthy();
  });

  it("GivenALongSummary_WhenAndyClicksShowReport_ThenTheReportIsShown", async () => {
    const harness = await setup();
    const run = await harness.queueRun();
    const summary = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    await harness.runs.update(run.id, { status: "succeeded", summary }, ["queued"]);
    const section = await harness.open();

    await harness.user.click(await within(section).findByRole("button", { name: "Show report" }));

    expect(within(section).getByText(/line 19/)).toBeTruthy();
  });

  it("GivenARunInFlight_WhenItFinishes_ThenThePollShowsItAndHistoryRefetches", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const harness = await setup();
    const run = await harness.queueRun();
    const section = await harness.open();
    expect(await within(section).findByText("queued")).toBeTruthy();

    // The run reports back: its status changes and it leaves a comment on the ticket.
    await harness.runs.update(run.id, { status: "succeeded", summary: "Done." }, ["queued"]);
    await harness.service.comment("ai", harness.ticket.id, "Refined the ticket.", "agent");
    await act(() => vi.advanceTimersByTimeAsync(RUN_POLL_MS));

    expect(await within(section).findByText("succeeded")).toBeTruthy();
    await waitFor(() => expect(within(section).getByText("Refined the ticket.")).toBeTruthy());
  });
});

describe("runsRefetchInterval", () => {
  it("GivenARunQueuedOrRunning_WhenComputed_ThenPollsEveryFiveSeconds", () => {
    expect(runsRefetchInterval([{ status: "succeeded" }, { status: "queued" }])).toBe(5_000);
    expect(runsRefetchInterval([{ status: "running" }])).toBe(5_000);
  });

  it("GivenNoActiveRuns_WhenComputed_ThenPollingIsOff", () => {
    expect(runsRefetchInterval(undefined)).toBe(false);
    expect(runsRefetchInterval([])).toBe(false);
    expect(
      runsRefetchInterval([{ status: "succeeded" }, { status: "failed" }, { status: "cancelled" }]),
    ).toBe(false);
  });
});

describe("formatCost", () => {
  it("GivenAnEstimatedCost_WhenFormatted_ThenItIsMarkedAsAnEstimate", () => {
    expect(formatCost({ costUsd: 0.02, costIsEstimate: true })).toBe("~$0.02 (estimate)");
    expect(formatCost({ costUsd: 1.5, costIsEstimate: false })).toBe("$1.50");
    expect(formatCost({ costUsd: null, costIsEstimate: false })).toBe("cost —");
  });
});
