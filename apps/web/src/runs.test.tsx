import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_ROUTE, ticketSnapshot } from "@andy/domain";
import { renderApp } from "@/test/harness";
import { LIVE_POLL_MS } from "@/lib/live";
import { formatCost } from "@/components/Runs";

/** Story panel → runs in the activity timeline (M1.6a: Claude Code executor), in-process API. */

const REPO = "albernhagen/andy-intelligence";
const plan = {
  files: ["apps/web/src/pages/BoardPage.tsx"],
  steps: ["Write the page"],
  tests: [],
  riskiestStep: "Ordering by rank",
  rejectedAlternatives: [],
};

async function setup() {
  const harness = renderApp("/", { githubConnected: true });
  await harness.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const ticket = await harness.service.create("ai", { type: "feature", title: "Board" }, "andy", {
    upNext: true,
  });
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
    await user.click(await within(section).findByRole("button", { name: "Start refine task" }));

    expect(await within(section).findByText("queued")).toBeTruthy();
    expect(within(section).getByText("sonnet")).toBeTruthy();
    const log = within(section).getByRole("link", { name: "Task log" });
    expect(log.getAttribute("href")).toMatch(
      /^https:\/\/github\.com\/albernhagen\/.+\/actions\/runs\//,
    );
    expect(log.getAttribute("target")).toBe("_blank");
    expect(log.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      within(section).getByRole("button", { name: "Start refine task" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(await runs.listForTicket("ai", ticket.id)).toHaveLength(1);
  });

  it("GivenARunInFlightOnAnotherTicket_WhenAndyStartsARun_ThenTheConflictIsShown", async () => {
    const harness = await setup();
    await harness.tracker.updateProject("ai", { runsAtOnce: 1 });
    await harness.queueRun();
    const other = await harness.service.create("ai", { type: "chore", title: "Other" }, "andy", {
      upNext: true,
    });
    const section = await harness.open(other.id);

    await harness.user.click(
      await within(section).findByRole("button", { name: "Start refine task" }),
    );

    expect((await within(section).findByRole("alert")).textContent).toMatch(
      /agent-tasks-at-once dial/,
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
      within(section).getByRole("button", { name: "Start refine task" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("GivenAPlanAwaitingAndy_WhenHeRejectsItWithAReason_ThenTheDecisionIsShownAndTheButtonsGo", async () => {
    const harness = await setup();
    const ticket = await harness.tracker.getTicket("ai", harness.ticket.id);
    const run = await harness.runs.create({
      projectId: "ai",
      ticketId: harness.ticket.id,
      step: "plan",
      route: DEFAULT_ROUTE,
      tier: "fast",
      deadline: null,
      prompt: ticketSnapshot(ticket!, []),
      maxTurns: 10,
    });
    await harness.runs.update(
      run.id,
      { status: "succeeded", endedAt: new Date().toISOString(), plan, summary: "The plan." },
      ["queued"],
    );
    const section = await harness.open();

    const reject = await within(section).findByRole("button", { name: "Reject plan" });
    expect(reject.hasAttribute("disabled")).toBe(true);
    expect(within(section).getByRole("button", { name: "Approve plan" })).toBeTruthy();
    await harness.user.type(
      within(section).getByRole("textbox", { name: "Reason to reject" }),
      "Reuse the list view.",
    );
    await harness.user.click(reject);

    expect(
      await within(section).findByText(/Plan rejected by .*: Reuse the list view\./),
    ).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "Approve plan" })).toBeNull();
    expect((await harness.runs.get(run.id))!.planDecision).toMatchObject({ decision: "rejected" });
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
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));

    expect(await within(section).findByText("succeeded")).toBeTruthy();
    await waitFor(() => expect(within(section).getByText("Refined the ticket.")).toBeTruthy());
  });
});

describe("ticket cost line", () => {
  it("GivenFinishedRuns_WhenTheStoryPanelOpens_ThenTheTotalAndEachRunsNumbersShow", async () => {
    const { open, runs, queueRun } = await setup();
    const priced = await queueRun();
    await runs.update(
      priced.id,
      {
        status: "succeeded",
        tokensIn: 1_500,
        tokensOut: 200,
        costUsd: 1.25,
        costIsEstimate: true,
        usage: {
          inputTokens: 500,
          outputTokens: 200,
          cacheReadTokens: 900,
          cacheWriteTokens: 100,
          turns: 4,
          wallMs: 62_000,
        },
        quotaDelta: { "5h": 3.5, weekly: 0.5 },
      },
      ["queued"],
    );
    const unknown = await queueRun();
    await runs.update(unknown.id, { status: "failed" }, ["queued"]);

    const section = await open();

    expect((await screen.findByLabelText("Ticket cost")).textContent).toBe(
      "Cost ~$1.25 (estimate) · quota 5h +3.5%, weekly +0.5% · 1 agent task unknown",
    );
    await within(section).findByText(
      "900 cache read · 100 cache write · 4 turns · 62s · quota 5h +3.5%, weekly +0.5%",
    );
    within(section).getByText("Cost unknown");
  });

  it("GivenTokensButNoCost_WhenTheStoryPanelOpens_ThenTheRunAndTheTotalBothSayUnknown", async () => {
    const { open, runs, queueRun } = await setup();
    const run = await queueRun();
    await runs.update(run.id, { status: "succeeded", tokensIn: 10, tokensOut: 2 }, ["queued"]);

    const section = await open();

    expect((await screen.findByLabelText("Ticket cost")).textContent).toBe(
      "Cost unknown · 1 agent task unknown",
    );
    await within(section).findByText("Cost unknown");
    expect(within(section).queryByText(/cost —/)).toBeNull();
  });

  it("GivenOnlyAnActiveRun_WhenTheStoryPanelOpens_ThenNoCostLine", async () => {
    const { open, queueRun } = await setup();
    await queueRun();
    await open();
    await screen.findByText("queued");
    expect(screen.queryByLabelText("Ticket cost")).toBeNull();
  });
});

describe("formatCost", () => {
  it("GivenAnEstimatedCost_WhenFormatted_ThenItIsMarkedAsAnEstimate", () => {
    expect(formatCost({ costUsd: 0.02, costIsEstimate: true })).toBe("~$0.02 (estimate)");
    expect(formatCost({ costUsd: 1.5, costIsEstimate: false })).toBe("$1.50");
    expect(formatCost({ costUsd: null, costIsEstimate: false })).toBe("cost —");
  });
});
