import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { NewTicket } from "@andy/contracts";
import { renderApp } from "@/test/harness";
import { formatSpend } from "@/components/NightLaunch";

const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;

/** "Plan the night" in the epic panel (AI-120: M4.17: Night launch step in UI and MCP). */
describe("plan the night", () => {
  async function withEpic(stories: Partial<NewTicket>[]) {
    const harness = renderApp();
    const { tracker } = harness;
    await tracker.createProject({ name: "AI", key: "AI" });
    const epic = await tracker.createTicket("ai", { title: "Night", type: "epic" }, "andy");
    const made = [];
    for (const [i, extra] of stories.entries()) {
      const t = await tracker.createTicket(
        "ai",
        {
          type: "feature",
          title: `Story ${i + 1}`,
          body: "A story.",
          acceptanceCriteria: ["When Andy opens it, the system shall show it."],
          size: "S",
          sizeReason: "small",
          parentId: epic.id,
          ...extra,
        },
        "andy",
      );
      made.push(
        await tracker.updateTicket(
          "ai",
          t.id,
          { stage: { to: "ready", forced: true, reason: null } },
          "andy",
        ),
      );
    }
    await harness.router.navigate({ to: `/p/ai/t/${epic.key}` });
    const section = await screen.findByRole("region", { name: "Plan the night" });
    return { harness, epic, stories: made, section };
  }

  it("GivenOpenQuestionsAndUnapprovedPlans_WhenTheSectionOpens_ThenEachIsListedWithLinksAndLaunchIsOff", async () => {
    const harness = renderApp();
    const { tracker, runs } = harness;
    await tracker.createProject({ name: "AI", key: "AI" });
    const epic = await tracker.createTicket("ai", { title: "Night", type: "epic" }, "andy");
    const story = (title: string, extra: Partial<NewTicket>) =>
      tracker.createTicket(
        "ai",
        {
          type: "feature",
          title,
          body: "A story.",
          acceptanceCriteria: ["When Andy opens it, the system shall show it."],
          sizeReason: "why",
          parentId: epic.id,
          ...extra,
        },
        "andy",
      );
    const asking = await story("Asking", { size: "S" });
    await tracker.askQuestion("ai", asking.id, { text: "Which lane?" }, "andy");
    const big = await story("Big", { size: "M" });
    const plan = await runs.create({
      projectId: "ai",
      ticketId: big.id,
      step: "plan",
      route,
      tier: null,
    });
    for (const t of [asking, big]) {
      await tracker.updateTicket(
        "ai",
        t.id,
        { stage: { to: "ready", forced: true, reason: null } },
        "andy",
      );
    }
    await harness.router.navigate({ to: `/p/ai/t/${epic.key}` });
    const section = await screen.findByRole("region", { name: "Plan the night" });
    const list = await within(section).findByRole("list", { name: "Launch checklist" });

    const question = within(list).getByRole("link", { name: "Question: Which lane?" });
    expect(question.getAttribute("href")).toBe(`/p/ai/t/${asking.key}`);
    const planLink = within(list).getByRole("link", { name: "Plan still running" });
    expect(planLink.getAttribute("href")).toBe(`/p/ai/runs/${plan.id}`);
    expect(within(section).getByRole("button", { name: "Launch" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      within(section).getByText(/Launch is off until the checklist is clear/).textContent,
    ).toContain(`${asking.key}: 1 open question; ${big.key}: size M, plan still running`);
  });

  it("GivenAClearChecklist_WhenAndyLaunchesThenStops_ThenProgressAndSpendShowAndThenStopping", async () => {
    const { section } = await withEpic([{}, {}]);
    const form = await within(section).findByRole("form", { name: "Launch the night" });
    const stopAt = new Date(Date.now() + 4 * 3_600_000);
    const local = new Date(stopAt.getTime() - stopAt.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    fireEvent.change(within(form).getByLabelText(/^Stop time/), { target: { value: local } });
    fireEvent.click(within(form).getByRole("button", { name: "Launch" }));

    const running = await within(section).findByLabelText("Night launch");
    expect(within(running).getByText("Running")).toBeTruthy();
    expect(within(running).getByLabelText("Night progress").textContent).toBe(
      "0 of 2 stories done · 0 running · 0 stopped · 2 waiting",
    );
    expect(within(running).getByLabelText("Night spend").textContent).toBe(
      "0 of 20 agent tasks · 0 of 5,000,000 tokens · ~$0.00 of $50 (estimate)",
    );

    fireEvent.click(within(running).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(within(section).getByText("Stopping")).toBeTruthy());
    expect(within(section).getByText(/No new agent tasks start/)).toBeTruthy();
  });

  it("GivenAStoryNotReady_WhenTheSectionOpens_ThenItsProblemShowsUnderIt", async () => {
    const { harness, stories, section } = await withEpic([{}]);
    await harness.tracker.updateTicket(
      "ai",
      stories[0]!.id,
      { stage: { to: "backlog", forced: true, reason: null } },
      "andy",
    );
    await harness.queryClient.invalidateQueries();
    const list = await within(section).findByRole("list", { name: "Launch checklist" });
    expect(await within(list).findByText("in Backlog, not Ready")).toBeTruthy();
    expect(within(list).getByText("1 problem")).toBeTruthy();
  });

  it("GivenABadBudget_WhenLaunched_ThenTheApiProblemIsShown", async () => {
    const { section } = await withEpic([{}]);
    const form = await within(section).findByRole("form", { name: "Launch the night" });
    fireEvent.change(within(form).getByLabelText(/^Max USD/), { target: { value: "9999" } });
    fireEvent.click(within(form).getByRole("button", { name: "Launch" }));
    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toContain("budget: max USD is over the cap of 500");
    expect(alert.textContent).toContain("stop time is missing");
  });

  it("GivenSpendWithUnknownTasks_WhenFormatted_ThenItSaysSoAgainstTheBudget", () => {
    expect(
      formatSpend(
        { runs: 3, tokens: 120000, estimatedUsd: 1.234, unknownRuns: 1 },
        { maxRuns: 10, maxTokens: 1000000, maxUsd: 20 },
      ),
    ).toBe(
      "3 of 10 agent tasks · 120,000 of 1,000,000 tokens · ~$1.23 of $20 (estimate) · 1 agent task unknown",
    );
  });
});
