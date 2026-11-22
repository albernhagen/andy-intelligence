import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_ROUTE } from "@andy/domain";
import { renderApp } from "@/test/harness";
import { gateText, prLabel, runSummary, wallMs } from "@/pages/RunPage";
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
    expect(within(page).getByRole("heading", { name: "Agent task · build" })).toBeTruthy();
    expect(within(page).getByText("succeeded")).toBeTruthy();
    const details = within(page).getByRole("region", { name: "Details" });
    expect(details.textContent).toContain(DEFAULT_ROUTE.model);
    expect(details.textContent).toContain("12 min");
    const usage = within(page).getByRole("region", { name: "Usage and cost" });
    expect(usage.textContent).toContain((12000).toLocaleString());
    expect(usage.textContent).toContain((50000).toLocaleString());
    expect(usage.textContent).toContain("~$1.25 (estimate)");
    expect(usage.textContent).toContain("5h +4%, weekly +1%");
    expect(details.textContent).toContain("merged with no rework");
    expect(details.textContent).toContain("waits for you: protected path");
    // AI-340: one sentence first, naming the ticket, the time, the PR and the gate.
    expect(
      (await within(page).findByLabelText("What happened", { selector: "p" })).textContent,
    ).toBe("Built AI-1 in 12 min: PR #7, waits for you: protected path.");
    expect(within(page).getByRole("region", { name: "Verification" }).textContent).toContain(
      "pnpm test",
    );
    expect(within(page).getByRole("link", { name: "Task log" }).getAttribute("href")).toBe(LOG);
    expect(within(page).getByRole("link", { name: "PR #7" }).getAttribute("href")).toBe(PR);
    const ticket = await within(page).findByRole("link", { name: "AI-1: Board" });
    expect(ticket.getAttribute("href")).toBe("/p/ai/t/AI-1");
  });

  it("GivenARunWithNoUsage_WhenItsPageOpens_ThenCostIsUnknownNotZero", async () => {
    const h = await setup();
    const run = await h.newRun();
    await h.runs.update(run.id, { status: "failed", endedAt: "2026-11-04T14:00:00.000Z" }, [
      "queued",
    ]);
    await open(h, `/p/ai/runs/${run.id}`);

    const usage = await screen.findByRole("region", { name: "Usage and cost" });
    expect(usage.textContent).toContain("Costunknown");
    expect(usage.textContent).not.toContain("$0");
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
    // The story panel loads several queries; give it longer on a busy machine.
    const activity = await screen.findByRole("region", { name: "Activity" }, { timeout: 5000 });

    await h.user.click(await within(activity).findByRole("link", { name: "Agent task · build" }));

    await waitFor(() => expect(h.router.state.location.pathname).toBe(`/p/ai/runs/${run.id}`));
    expect(await screen.findByRole("heading", { name: "Agent task · build" })).toBeTruthy();
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
    // Nothing reported yet: no Usage and cost heading over an empty list.
    expect(within(page).queryByRole("region", { name: "Usage and cost" })).toBeNull();
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
