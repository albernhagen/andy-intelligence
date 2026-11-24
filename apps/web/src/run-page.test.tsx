import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { Run, TicketEvent } from "@andy/contracts";
import { DEFAULT_ROUTE } from "@andy/domain";
import { renderApp } from "@/test/harness";
import {
  errorReason,
  gateText,
  prLabel,
  runSummary,
  statusText,
  timeline,
  waitingText,
  wallMs,
} from "@/pages/RunPage";
import { elapsed } from "@/lib/format";
import { httpsHref } from "@/components/Runs";

/** AI-101: the agent task detail screen, over the real API in-process. */

const LOG = "https://github.com/albernhagen/andy-intelligence/actions/runs/42";
const PR = "https://github.com/albernhagen/andy-intelligence/pull/7";

async function setup(path = "/") {
  const harness = renderApp(path);
  await harness.tracker.createProject({ name: "AI", key: "AI" });
  const ticket = await harness.tracker.createTicket(
    "ai",
    { type: "feature", title: "Board" },
    "andy",
  );
  const newRun = (projectId = "ai", ticketId = ticket.id) =>
    harness.runs.create({
      projectId,
      ticketId,
      step: "build",
      route: DEFAULT_ROUTE,
      tier: null,
    });
  return { ...harness, ticket, newRun };
}

const open = async (h: Awaited<ReturnType<typeof setup>>, path: string) => {
  await h.router.navigate({ to: path });
  await h.router.invalidate();
};

describe("agent task page", () => {
  it("GivenAFinishedBuild_WhenAndyOpensItsPage_ThenStepModelStatusTimingsTokensCostOutcomeAndLinksShow", async () => {
    const h = await setup();
    const run = await h.newRun();
    await h.runs.update(
      run.id,
      {
        status: "succeeded",
        startedAt: "2026-11-04T14:00:00.000Z",
        endedAt: "2026-11-04T14:12:00.000Z",
        tokensIn: 12000,
        tokensOut: 3400,
        costUsd: 1.25,
        costIsEstimate: true,
        usage: {
          inputTokens: 12000,
          outputTokens: 3400,
          cacheReadTokens: 50000,
          cacheWriteTokens: 800,
          turns: 31,
          wallMs: null,
        },
        quotaDelta: { "5h": 4, weekly: 1 },
        outcome: "merged_clean",
        wouldAutoMerge: false,
        gateReasons: ["protected_path"],
        links: { executorRun: LOG, pullRequest: PR },
        verification: [{ command: "pnpm test", passed: true, output: "42 passed" }],
      },
      ["queued"],
    );
    await open(h, `/p/ai/runs/${run.id}`);

    const page = await screen.findByRole("article", { name: "Agent task" });
    expect(within(page).getByRole("heading", { name: "Agent task · Build" })).toBeTruthy();
    expect(within(page).getByText("Succeeded · 12 min")).toBeTruthy();
    const details = within(page).getByRole("region", { name: "Details" });
    expect(details.textContent).toContain("12 min");
    const usage = within(page).getByRole("region", { name: "Usage" });
    expect(usage.textContent).toContain((12000).toLocaleString());
    expect(usage.textContent).toContain((50000).toLocaleString());
    // AI-377: model, cost, quota and PR beside the timeline.
    const side = within(page).getByRole("complementary", { name: "Cost and links" });
    expect(side.textContent).toContain(DEFAULT_ROUTE.model);
    expect(side.textContent).toContain("~$1.25 (estimate)");
    expect(side.textContent).toContain("5h +4%, weekly +1%");
    expect(details.textContent).toContain("merged with no rework");
    expect(details.textContent).toContain("waits for you: protected path");
    // AI-340: one sentence first, naming the ticket, the time, the PR and the gate.
    expect(
      (await within(page).findByLabelText("What happened", { selector: "p" })).textContent,
    ).toBe("Built AI-1 in 12 min: PR #7, waits for you: protected path.");
    expect(within(page).getByRole("region", { name: "Verification" }).textContent).toContain(
      "pnpm test",
    );
    expect(within(page).getByRole("link", { name: "Open log" }).getAttribute("href")).toBe(LOG);
    expect(within(side).getByRole("link", { name: "PR #7" }).getAttribute("href")).toBe(PR);
    const ticket = await within(side).findByRole("link", { name: "AI-1: Board" });
    expect(ticket.getAttribute("href")).toBe("/p/ai/t/AI-1");
  });

  it("GivenARunWithNoUsage_WhenItsPageOpens_ThenCostIsUnknownNotZero", async () => {
    const h = await setup();
    const run = await h.newRun();
    await h.runs.update(run.id, { status: "failed", endedAt: "2026-11-04T14:00:00.000Z" }, [
      "queued",
    ]);
    await open(h, `/p/ai/runs/${run.id}`);

    const side = await screen.findByRole("complementary", { name: "Cost and links" });
    expect(side.textContent).toContain("Costunknown");
    expect(side.textContent).not.toContain("$0");
  });

  it("GivenARetry_WhenItsPageOpens_ThenItLinksToTheRunItRetries", async () => {
    const h = await setup();
    const first = await h.newRun();
    const retry = await h.runs.create({
      projectId: "ai",
      ticketId: h.ticket.id,
      step: "build",
      route: DEFAULT_ROUTE,
      tier: null,
      attempt: 2,
      retryOf: first.id,
    });
    await open(h, `/p/ai/runs/${retry.id}`);

    const link = await screen.findByRole("link", { name: "Retry of the earlier agent task" });
    expect(link.getAttribute("href")).toBe(`/p/ai/runs/${first.id}`);
  });

  it("GivenAPlanRun_WhenItsPageOpens_ThenThePlanShows", async () => {
    const h = await setup();
    const run = await h.newRun();
    await h.runs.update(
      run.id,
      {
        status: "succeeded",
        plan: {
          files: ["apps/web/src/pages/RunPage.tsx"],
          steps: ["Add the route", "Write the page"],
          tests: [],
          riskiestStep: "Cross-project reads",
          rejectedAlternatives: [],
        },
      },
      ["queued"],
    );
    await open(h, `/p/ai/runs/${run.id}`);

    const plan = await screen.findByRole("region", { name: "Plan" });
    expect(
      within(plan)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Add the route", "Write the page"]);
    expect(plan.textContent).toContain("Cross-project reads");
  });

  it("GivenAnUnknownId_WhenTheRunPageOpens_ThenItSaysNotFound", async () => {
    const h = await setup();
    await open(h, "/p/ai/runs/no-such-task");
    expect(await screen.findByText("Agent task not found.")).toBeTruthy();
  });

  it("GivenAnotherProjectsRun_WhenOpenedUnderThisProject_ThenNotFoundAndNothingOfItShows", async () => {
    const h = await setup();
    await h.tracker.createProject({ name: "Ops", key: "OPS" });
    const theirs = await h.newRun("ops", "ops-ticket");
    await h.runs.update(theirs.id, { status: "failed", error: "secret ops failure" }, ["queued"]);
    await open(h, `/p/ai/runs/${theirs.id}`);

    expect(await screen.findByText("Agent task not found.")).toBeTruthy();
    expect(screen.queryByText("secret ops failure")).toBeNull();
  });

  it("GivenATicketWithARun_WhenAndyClicksItInTheRunList_ThenTheRunPageOpens", async () => {
    const h = await setup();
    const run = await h.newRun();
    await open(h, `/p/ai/t/${h.ticket.id}`);
    // The ticket panel loads several queries; give it longer on a busy machine.
    const activity = await screen.findByRole("region", { name: "Activity" }, { timeout: 5000 });

    await h.user.click(await within(activity).findByRole("link", { name: "Agent task · build" }));

    await waitFor(() => expect(h.router.state.location.pathname).toBe(`/p/ai/runs/${run.id}`));
    expect(await screen.findByRole("heading", { name: "Agent task · Build" })).toBeTruthy();
  });
});

describe("agent task page helpers", () => {
  it("GivenHarnessWallTime_WhenWallMsIsRead_ThenItWinsOverTimestamps", () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      turns: null,
      wallMs: 5000,
    };
    expect(
      wallMs({ usage, startedAt: "2026-11-04T14:00:00Z", endedAt: "2026-11-04T15:00:00Z" }),
    ).toBe(5000);
    expect(wallMs({ usage: null, startedAt: "2026-11-04T14:00:00Z", endedAt: null })).toBeNull();
  });

  it("GivenDurations_WhenFormatted_ThenSecondsMinutesOrWords", () => {
    expect(elapsed(42_000)).toBe("42 s");
    expect(elapsed(720_000)).toBe("12 min");
    expect(elapsed(725_000)).toBe("12 min 5 s");
    expect(elapsed(3 * 60 * 60_000 + 5_000)).toBe("3 hours");
  });

  it("GivenGateStates_WhenDescribed_ThenNothingWouldMergeOrWaitsWithReasonsInWords", () => {
    expect(gateText({ wouldAutoMerge: null, gateReasons: [] })).toBeNull();
    expect(gateText({ wouldAutoMerge: true, gateReasons: [] })).toBe("would merge on its own");
    expect(gateText({ wouldAutoMerge: false, gateReasons: ["draft", "checks_failed"] })).toBe(
      "waits for you: draft, checks failed",
    );
  });

  it("GivenARunningRefine_WhenItsPageOpens_ThenItSaysWhatItIsDoingAndHidesEmptyRows", async () => {
    const h = await setup();
    const run = await h.runs.create({
      projectId: "ai",
      ticketId: h.ticket.id,
      step: "refine",
      route: DEFAULT_ROUTE,
      tier: null,
    });
    await h.runs.update(run.id, { status: "running", startedAt: new Date().toISOString() }, [
      "queued",
    ]);
    await open(h, `/p/ai/runs/${run.id}`);

    const page = await screen.findByRole("article", { name: "Agent task" });
    await waitFor(() =>
      expect(within(page).getByLabelText("What happened", { selector: "p" }).textContent).toMatch(
        new RegExp(`^Refining AI-1 for \\d+ s on ${DEFAULT_ROUTE.model}\\.$`),
      ),
    );
    const text = page.textContent ?? "";
    expect(text).not.toContain("—");
    expect(text).not.toContain("unknown");
    expect(text).not.toContain("Gate");
    for (const label of ["Ended", "Wall time", "Tokens in", "Cost", "Quota used", "Tier"])
      expect(within(page).queryByText(label, { selector: "dt" })).toBeNull();
    expect(within(page).getByText("Started", { selector: "dt" })).toBeTruthy();
    // Nothing reported yet: no Usage heading over an empty list.
    expect(within(page).queryByRole("region", { name: "Usage" })).toBeNull();
  });

  it("GivenEachStatus_WhenSummarised_ThenOneSentenceSaysWhatHappened", () => {
    const base = {
      step: "build" as const,
      route: DEFAULT_ROUTE,
      createdAt: "2026-11-04T14:00:00.000Z",
      startedAt: "2026-11-04T14:00:00.000Z",
      endedAt: null,
      usage: null,
      links: {},
      error: null,
      wouldAutoMerge: null,
      gateReasons: [],
    };
    const now = new Date("2026-11-04T14:12:00.000Z");
    const m = DEFAULT_ROUTE.model;
    expect(runSummary({ ...base, status: "queued" }, "AI-7", now)).toBe(
      `Waiting to start: building AI-7 on ${m}.`,
    );
    expect(runSummary({ ...base, status: "running" }, "AI-7", now)).toBe(
      `Building AI-7 for 12 min on ${m}.`,
    );
    const ended = { ...base, endedAt: "2026-11-04T14:10:00.000Z" };
    expect(
      runSummary(
        { ...ended, status: "succeeded", links: { pullRequest: PR }, wouldAutoMerge: true },
        "AI-7",
        now,
      ),
    ).toBe("Built AI-7 in 10 min: PR #7, would merge on its own.");
    expect(runSummary({ ...ended, status: "succeeded", step: "refine" }, "AI-3", now)).toBe(
      "Refined AI-3 in 10 min.",
    );
    const odd = { ...base, endedAt: "2026-11-04T14:10:10.000Z", status: "succeeded" as const };
    expect(runSummary(odd, "AI-7", now)).toBe("Built AI-7 in 10 min.");
    expect(
      runSummary({ ...ended, status: "failed", error: "Checks failed\nstack…" }, "AI-7", now),
    ).toBe("Failed after 10 min: Checks failed.");
    expect(runSummary({ ...base, status: "failed" }, null, now)).toBe("Failed: building.");
    expect(runSummary({ ...base, status: "cancelled", step: "sync" }, "AI-7", now)).toBe(
      "Cancelled: syncing AI-7.",
    );
    // A cancelled task says why when it can; a blank first line never hides the reason.
    expect(
      runSummary({ ...ended, status: "cancelled", error: "Cancelled by Andy" }, "AI-7", now),
    ).toBe("Cancelled: Cancelled by Andy.");
    expect(runSummary({ ...ended, status: "failed", error: "\nChecks failed" }, "AI-7", now)).toBe(
      "Failed after 10 min: Checks failed.",
    );
  });

  it("GivenAFailedTask_WhenItsPageOpens_ThenAOneLineErrorShowsOnceAndALongerOneInFull", async () => {
    const h = await setup();
    const short = await h.newRun();
    await h.runs.update(short.id, { status: "failed", error: "Checks failed" }, ["queued"]);
    await open(h, `/p/ai/runs/${short.id}`);
    let page = await screen.findByRole("article", { name: "Agent task" });
    await waitFor(() => expect(within(page).getAllByText(/Checks failed/)).toHaveLength(1));

    const long = await h.newRun();
    await h.runs.update(
      long.id,
      { status: "failed", error: "Checks failed\npnpm test: 2 failing" },
      ["queued"],
    );
    await open(h, `/p/ai/runs/${long.id}`);
    page = await screen.findByRole("article", { name: "Agent task" });
    expect(await within(page).findByText(/pnpm test: 2 failing/)).toBeTruthy();
  });

  it("GivenErrorsWithBlankLines_WhenSplit_ThenTheFirstNonBlankLineLeadsAndMoreIsCounted", () => {
    expect(errorReason(null)).toBeNull();
    expect(errorReason(" \n ")).toBeNull();
    expect(errorReason("Checks failed")).toEqual({ first: "Checks failed", more: false });
    expect(errorReason("\n  Checks failed  \n")).toEqual({ first: "Checks failed", more: false });
    expect(errorReason("\nChecks failed\n\npnpm test")).toEqual({
      first: "Checks failed",
      more: true,
    });
  });

  it("GivenACancelledTaskWithAReason_WhenItsPageOpens_ThenTheReasonShowsOnce", async () => {
    const h = await setup();
    const run = await h.newRun();
    await h.runs.update(run.id, { status: "cancelled", error: "Superseded by a newer build" }, [
      "queued",
    ]);
    await open(h, `/p/ai/runs/${run.id}`);
    const page = await screen.findByRole("article", { name: "Agent task" });
    await waitFor(() =>
      expect(within(page).getAllByText(/Superseded by a newer build/)).toHaveLength(1),
    );
  });

  it("GivenAnErrorLedByABlankLine_WhenItsPageOpens_ThenTheReasonShowsOnce", async () => {
    const h = await setup();
    const run = await h.newRun();
    await h.runs.update(run.id, { status: "failed", error: "\nChecks failed" }, ["queued"]);
    await open(h, `/p/ai/runs/${run.id}`);
    const page = await screen.findByRole("article", { name: "Agent task" });
    await waitFor(() => expect(within(page).getAllByText(/Checks failed/)).toHaveLength(1));
  });

  it("GivenPrUrls_WhenLabelled_ThenTheNumberShows", () => {
    expect(prLabel(PR)).toBe("PR #7");
    expect(prLabel("https://example.com/x")).toBe("Pull request");
  });

  it("GivenNonHttpsUrls_WhenCheckedForLinks_ThenOnlyHttpsRenders", () => {
    expect(httpsHref(PR)).toBe(PR);
    expect(httpsHref("javascript:alert(1)")).toBeUndefined();
    expect(httpsHref("http://example.com")).toBeUndefined();
    expect(httpsHref("not a url")).toBeUndefined();
    expect(httpsHref(undefined)).toBeUndefined();
  });
});

/** AI-377: the page on direction A: live progress, a timeline, and the outcome first. */
describe("agent task page: live progress and outcome", () => {
  const startRefine = async (h: Awaited<ReturnType<typeof setup>>, startedAt: string) => {
    const run = await h.runs.create({
      projectId: "ai",
      ticketId: h.ticket.id,
      step: "refine",
      route: DEFAULT_ROUTE,
      tier: "fast",
    });
    await h.runs.update(run.id, { status: "running", startedAt }, ["queued"]);
    return run;
  };

  it("GivenARunningTask_WhenTimePasses_ThenItsCurrentStepAndElapsedTimeUpdateWithoutAReload", async () => {
    const h = await setup();
    const run = await startRefine(h, new Date(Date.now() - 5_000).toISOString());
    await open(h, `/p/ai/runs/${run.id}`);

    const page = await screen.findByRole("article", { name: "Agent task" });
    const current = await within(page).findByRole("listitem", { current: "step" });
    expect(current.textContent).toContain("Refining now");
    const badge = within(page).getByText(/^Running · \d+ s$/);
    const first = badge.textContent;

    // The clock ticks on the page itself; no navigation, no refetch.
    await waitFor(() => expect(badge.textContent).not.toBe(first));
    expect(within(page).getByRole("listitem", { current: "step" }).textContent).toMatch(
      /for \d+ s/,
    );
  });

  it("GivenARunningTask_WhenItEndsOnTheServer_ThenTheNextPollShowsTheOutcomeInPlace", async () => {
    const h = await setup();
    const run = await startRefine(h, new Date(Date.now() - 60_000).toISOString());
    await open(h, `/p/ai/runs/${run.id}`);
    const page = await screen.findByRole("article", { name: "Agent task" });
    await within(page).findByText(/^Running · /);

    await h.runs.update(run.id, { status: "succeeded", endedAt: new Date().toISOString() }, [
      "running",
    ]);
    // What the live poll does while the task is in flight.
    await h.queryClient.refetchQueries({ type: "active" });

    expect(await within(page).findByText(/^Succeeded · /)).toBeTruthy();
    expect(within(page).queryByRole("listitem", { current: "step" })).toBeNull();
    expect(within(page).getByLabelText("What happened", { selector: "p" }).textContent).toMatch(
      /^Refined AI-1 in /,
    );
  });

  it("GivenAnOpenQuestion_WhenTheTaskRuns_ThenItWaitsOnYourAnswerWithALinkToTheInbox", async () => {
    const h = await setup();
    const run = await startRefine(h, new Date(Date.now() - 60_000).toISOString());
    await h.service.ask("ai", h.ticket.id, { text: "Should Esc close the panel?" }, "agent");
    await open(h, `/p/ai/runs/${run.id}`);

    const page = await screen.findByRole("article", { name: "Agent task" });
    const current = await within(page).findByRole("listitem", { current: "step" });
    await waitFor(() => expect(current.textContent).toContain("Waiting on your answer"));
    expect(current.textContent).toContain("Should Esc close the panel?");
    expect(
      within(current).getByRole("link", { name: "Answer in inbox" }).getAttribute("href"),
    ).toBe("/p/ai/inbox");
    expect(within(page).getByLabelText("What happened", { selector: "p" }).textContent).toContain(
      "It waits on your answer to one question.",
    );
  });

  it("GivenAnEndedTask_WhenItsPageOpens_ThenOneSentenceOfOutcomeLeadsThenThePrCostAndQuota", async () => {
    const h = await setup();
    const run = await h.newRun();
    await h.runs.update(
      run.id,
      {
        status: "succeeded",
        startedAt: "2026-11-04T14:00:00.000Z",
        endedAt: "2026-11-04T14:10:00.000Z",
        costUsd: 0.4,
        quotaDelta: { "5h": 2, weekly: null },
        links: { executorRun: LOG, pullRequest: PR },
      },
      ["queued"],
    );
    await open(h, `/p/ai/runs/${run.id}`);

    const page = await screen.findByRole("article", { name: "Agent task" });
    const sentence = within(page).getByLabelText("What happened", { selector: "p" });
    await waitFor(() => expect(sentence.textContent).toBe("Built AI-1 in 10 min: PR #7."));
    const side = within(page).getByRole("complementary", { name: "Cost and links" });
    // The sentence comes first in reading order; the PR, cost and quota follow it.
    expect(sentence.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(page).getByRole("list", { name: "Timeline" }).compareDocumentPosition(side)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    const text = side.textContent ?? "";
    expect(text.indexOf("Quota used")).toBeLessThan(text.indexOf("Cost"));
    expect(text).toContain("$0.40");
    expect(text).toContain("5h +2%");
    expect(within(side).getByRole("link", { name: "PR #7" })).toBeTruthy();
  });
});

describe("agent task page: timeline", () => {
  const run = (over: Partial<Run> = {}): Run =>
    ({
      id: "r1",
      projectId: "ai",
      ticketId: "t1",
      step: "build",
      route: DEFAULT_ROUTE,
      tier: "fast",
      status: "running",
      createdAt: "2026-11-04T14:00:00.000Z",
      startedAt: "2026-11-04T14:01:00.000Z",
      endedAt: null,
      attempt: 1,
      pushGrantedAt: null,
      branch: null,
      error: null,
      usage: null,
      ...over,
    }) as Run;
  const event = (kind: TicketEvent["kind"], at: string, runId: string | null, data = {}) =>
    ({
      id: `${kind}-${at}`,
      ticketId: "t1",
      kind,
      actor: "system",
      runId,
      body: null,
      data,
      createdAt: at,
    }) as TicketEvent;
  const now = new Date("2026-11-04T14:05:00.000Z");

  it("GivenARunWithEvents_WhenTheTimelineIsBuilt_ThenItsStepsShowNewestFirstAndOthersRunsAreLeftOut", () => {
    const entries = timeline(
      run({ pushGrantedAt: "2026-11-04T14:04:00.000Z", branch: "agent/AI-1/x" }),
      [
        event("pr_linked", "2026-11-04T14:04:30.000Z", "r1", { url: PR }),
        event("pr_linked", "2026-11-04T14:03:00.000Z", "other-run", { url: PR }),
        event("comment", "2026-11-04T14:02:00.000Z", "r1"),
      ],
      [],
      now,
    );

    expect(entries.map((e) => [e.title, e.at])).toEqual([
      ["Building now", null],
      ["Opened PR #7", "2026-11-04T14:04:30.000Z"],
      ["Publishing its branch", "2026-11-04T14:04:00.000Z"],
      ["Started", "2026-11-04T14:01:00.000Z"],
      ["Queued", "2026-11-04T14:00:00.000Z"],
    ]);
    expect(entries[0]).toMatchObject({ tone: "now", detail: "for 4 min" });
    expect(entries[3]!.detail).toBe(`${DEFAULT_ROUTE.harness} · ${DEFAULT_ROUTE.model}`);
  });

  it("GivenAQueueStampAfterTheStart_WhenTheTimelineIsBuilt_ThenQueuedStaysOldest", () => {
    const entries = timeline(run({ createdAt: "2026-11-04T14:02:00.000Z" }), [], [], now);

    expect(entries.map((e) => [e.title, e.at]).slice(1)).toEqual([
      ["Started", "2026-11-04T14:01:00.000Z"],
      ["Queued", "2026-11-04T14:01:00.000Z"],
    ]);
  });

  it("GivenAFailedRun_WhenTheTimelineIsBuilt_ThenItEndsInFailedAndNothingIsInProgress", () => {
    const entries = timeline(
      run({ status: "failed", endedAt: "2026-11-04T14:03:00.000Z", error: "Checks failed" }),
      [],
      [],
      now,
    );

    expect(entries[0]).toMatchObject({ title: "Failed", tone: "failed" });
    expect(entries.some((e) => e.tone === "now")).toBe(false);
  });

  it("GivenStatuses_WhenTheBadgeIsWritten_ThenItSaysTheStatusAndHowLong", () => {
    expect(statusText(run(), now)).toBe("Running · 4 min");
    expect(statusText(run({ status: "queued", startedAt: null }), now)).toBe("Queued");
    expect(statusText(run({ status: "succeeded", endedAt: "2026-11-04T14:13:00.000Z" }), now)).toBe(
      "Succeeded · 12 min",
    );
    expect(waitingText(1)).toBe("It waits on your answer to one question.");
    expect(waitingText(2)).toBe("It waits on your answers to 2 questions.");
  });
});
