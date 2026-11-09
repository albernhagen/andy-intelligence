import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { readyStory, renderApp } from "@/test/harness";
import { workerStatus } from "@/lib/needs-you";

async function boardWithReady(defaultWorker: "me" | "ask") {
  const harness = renderApp();
  await harness.tracker.createProject({ name: "AI", key: "AI" });
  await harness.tracker.updateProject("ai", { defaultWorker });
  const ticket = await harness.service.create(
    "ai",
    { ...readyStory, title: "Write the parser by hand" },
    "andy",
  );
  await harness.service.move("ai", ticket.id, "ready", "andy");
  return { harness, ticket };
}

describe("worker markers", () => {
  it("GivenAReadyTicketWhoseWorkerIsAndy_WhenTheBoardOpens_ThenTheCardShowsMineAndTheInboxDoesNotListIt", async () => {
    const { harness, ticket } = await boardWithReady("me");

    await harness.router.navigate({ to: "/p/ai" });
    const ready = await screen.findByRole("region", { name: "Ready" });
    const card = (await within(ready).findByText(ticket.key)).closest("[data-ticket]");

    expect(within(card as HTMLElement).getByText("Mine")).toBeTruthy();
    expect(within(card as HTMLElement).getByText("Waiting on you")).toBeTruthy();
    expect(within(card as HTMLElement).queryByText("Next")).toBeNull();
    expect((await harness.service.needsYou()).tickets).toEqual([]);

    await harness.router.navigate({ to: "/" });
    expect(screen.queryByText(ticket.title)).toBeNull();
  });

  it("GivenAnAskProject_WhenTheBoardOpens_ThenTheCardNeedsAWorker", async () => {
    const { harness, ticket } = await boardWithReady("ask");

    await harness.router.navigate({ to: "/p/ai" });
    const ready = await screen.findByRole("region", { name: "Ready" });
    const card = (await within(ready).findByText(ticket.key)).closest("[data-ticket]");

    expect(within(card as HTMLElement).getByText("Needs a worker")).toBeTruthy();
  });

  it("GivenAMineTicket_WhenAndyClicksGiveToAgent_ThenTheWorkerIsStored", async () => {
    const { harness, ticket } = await boardWithReady("me");

    await harness.router.navigate({
      to: "/p/$projectId/t/$ticketRef",
      params: { projectId: "ai", ticketRef: ticket.key },
    });
    await harness.user.click(await screen.findByRole("button", { name: "Give to agent" }));

    await screen.findByRole("button", { name: "Make it mine" });
    expect((await harness.tracker.getTicket("ai", ticket.id))?.overrides.assignee).toBe("agent");
  });
});

describe("workerStatus", () => {
  it("GivenAMineTicketInBacklog_WhenRead_ThenItIsMineButNotWaiting", () => {
    expect(workerStatus("me", "backlog", "feature")).toEqual({
      mine: true,
      waiting: false,
      needsWorker: false,
    });
  });

  it("GivenADoneOrEpicTicket_WhenRead_ThenItDoesNotNeedAWorker", () => {
    expect(workerStatus("ask", "done", "feature").needsWorker).toBe(false);
    expect(workerStatus("ask", "ready", "epic").needsWorker).toBe(false);
  });
});
