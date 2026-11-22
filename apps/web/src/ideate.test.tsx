import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_ROUTE } from "@andy/domain";
import { PAGE_LOAD, renderApp } from "@/test/harness";

/** AI-299: ideate from the board, over the real API in-process (AI-134's ideate agent task). */

const REPO = "albernhagen/andy-intelligence";

async function board() {
  const harness = renderApp("/p/ai", { githubConnected: true });
  await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: [REPO] });
  await harness.router.invalidate();
  await screen.findByRole("heading", { name: /Board/ }, PAGE_LOAD);
  return harness;
}

async function startIdeate(harness: Awaited<ReturnType<typeof board>>, idea: string) {
  await harness.user.click(screen.getByRole("button", { name: "Ideate" }));
  const form = await screen.findByRole("form", { name: "Ideate" });
  await harness.user.type(within(form).getByLabelText("Idea"), idea);
  await harness.user.click(within(form).getByRole("button", { name: "Start ideate" }));
}

describe("ideate from the board", () => {
  it("GivenAnIdea_WhenAndyStartsIdeate_ThenAnIdeateAgentTaskStartsWithIt", async () => {
    const harness = await board();
    await startIdeate(harness, "A weekly summary email");

    const task = await screen.findByRole("region", { name: "Ideate agent task" });
    expect(within(task).getByText("queued")).toBeTruthy();
    const [run] = await harness.runs.listActive("ai");
    expect(run).toMatchObject({ step: "ideate", ticketId: null, idea: "A weekly summary email" });
    expect(
      within(task).getByRole("link", { name: "Agent task · ideate" }).getAttribute("href"),
    ).toBe(`/p/ai/runs/${run!.id}`);
  });

  it("GivenAStartedIdeate_WhenItRecordsAnEpic_ThenItsSummaryShowsAndTheEpicIsInIdeas", async () => {
    const harness = await board();
    await startIdeate(harness, "A weekly summary email");
    await screen.findByRole("region", { name: "Ideate agent task" });
    const [run] = await harness.runs.listActive("ai");
    const epic = await harness.service.create(
      "ai",
      { type: "epic", title: "Weekly summary email" },
      "andy",
    );
    await harness.runs.update(
      run!.id,
      { status: "succeeded", summary: `Created epic ${epic.key} in Ideas.` },
      ["queued"],
    );
    await harness.queryClient.invalidateQueries();

    const task = screen.getByRole("region", { name: "Ideate agent task" });
    expect(await within(task).findByText(`Created epic ${epic.key} in Ideas.`)).toBeTruthy();
    expect(within(task).getByText("succeeded")).toBeTruthy();
    expect(await screen.findByText("Weekly summary email")).toBeTruthy();
  });

  it("GivenARejectedResult_WhenTheTaskEnds_ThenTheReasonShowsAsTheTaskRecordedIt", async () => {
    const harness = await board();
    await startIdeate(harness, "Another idea");
    await screen.findByRole("region", { name: "Ideate agent task" });
    const [run] = await harness.runs.listActive("ai");
    const reason = "Its result wasn't recorded: the hourly cap on ideas is reached.";
    await harness.runs.update(run!.id, { status: "failed", error: reason }, ["queued"]);
    await harness.queryClient.invalidateQueries();

    const task = screen.getByRole("region", { name: "Ideate agent task" });
    expect(await within(task).findByText(reason)).toBeTruthy();
  });

  it("GivenAnIdeateTaskInFlight_WhenAndyStartsAnother_ThenTheApisReasonShowsAndNothingStarts", async () => {
    const harness = await board();
    await harness.runs.create({
      projectId: "ai",
      ticketId: null,
      step: "ideate",
      route: DEFAULT_ROUTE,
      tier: "strong",
      deadline: null,
      prompt: "ideate",
      maxTurns: 40,
      idea: "First idea",
    });
    await startIdeate(harness, "Second idea");

    const form = screen.getByRole("form", { name: "Ideate" });
    expect(await within(form).findByText(/already has a ideate task in flight/)).toBeTruthy();
    expect(await harness.runs.listActive("ai")).toHaveLength(1);
  });

  it("GivenTheForm_WhenAndyCancels_ThenItCloses", async () => {
    const harness = await board();
    await harness.user.click(screen.getByRole("button", { name: "Ideate" }));
    const form = await screen.findByRole("form", { name: "Ideate" });
    expect(
      within(form).getByRole("button", { name: "Start ideate" }).hasAttribute("disabled"),
    ).toBe(true);
    await harness.user.click(within(form).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Ideate" })).toBeNull());
  });
});
