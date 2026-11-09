import { InMemoryWorkTracker, type Ticket, type Worker } from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import { TicketService } from "./tickets";
import { isDispatchable, resolveWorker, workerView } from "./worker";

const ticket = (assignee?: Ticket["overrides"]["assignee"]) => ({
  overrides: assignee ? { assignee } : {},
});
const project = (defaultWorker: Worker) => ({ defaultWorker });

describe("resolveWorker", () => {
  it.each(["agent", "me", "ask"] as const)(
    "GivenNoOverride_WhenDefaultIs%s_ThenTheDefaultApplies",
    (value) => {
      expect(resolveWorker(ticket(), project(value))).toBe(value);
    },
  );

  it("GivenAMeOverride_WhenTheDefaultIsAgent_ThenTheWorkerIsMe", () => {
    expect(resolveWorker(ticket("me"), project("agent"))).toBe("me");
  });

  it("GivenAnAgentOverride_WhenTheDefaultIsMe_ThenTheWorkerIsAgent", () => {
    expect(resolveWorker(ticket("agent"), project("me"))).toBe("agent");
  });

  it("GivenAHarnessKeyOverride_WhenTheDefaultIsAsk_ThenTheWorkerIsAgent", () => {
    expect(resolveWorker(ticket("claude-code"), project("ask"))).toBe("agent");
  });
});

describe("isDispatchable", () => {
  it("GivenAnAgentWorker_WhenChecked_ThenItIsDispatchable", () => {
    expect(isDispatchable(ticket(), project("agent"))).toBe(true);
    expect(isDispatchable(ticket("agent"), project("ask"))).toBe(true);
  });

  it("GivenAndyOrNoWorker_WhenChecked_ThenItIsNotDispatchable", () => {
    expect(isDispatchable(ticket(), project("me"))).toBe(false);
    expect(isDispatchable(ticket(), project("ask"))).toBe(false);
    expect(isDispatchable(ticket("me"), project("agent"))).toBe(false);
  });
});

describe("workerView", () => {
  it("GivenAHarnessKeyOverride_WhenViewed_ThenItReadsAsAnAgentPick", () => {
    expect(workerView(ticket("jules"), project("me"))).toEqual({
      worker: "agent",
      override: "agent",
      projectDefault: "me",
    });
  });

  it("GivenNoOverride_WhenViewed_ThenOverrideIsNull", () => {
    expect(workerView(ticket(), project("ask"))).toEqual({
      worker: "ask",
      override: null,
      projectDefault: "ask",
    });
  });
});

describe("TicketService.setWorker", () => {
  async function setup(dispatchNext = vi.fn(async () => null)) {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "AI", key: "AI" });
    const service = new TicketService(tracker, null, dispatchNext);
    const created = await tracker.createTicket(
      "ai",
      { title: "T", overrides: { tier: "strong" } },
      "andy",
    );
    return { tracker, service, created, dispatchNext };
  }

  it("GivenAPinnedTier_WhenTheWorkerIsSetAndCleared_ThenTheTierStays", async () => {
    const { tracker, service, created } = await setup();

    await service.setWorker("ai", created.id, "me", "andy");
    expect((await tracker.getTicket("ai", created.id))?.overrides).toEqual({
      tier: "strong",
      assignee: "me",
    });

    await service.setWorker("ai", created.id, null, "andy");
    expect((await tracker.getTicket("ai", created.id))?.overrides).toEqual({ tier: "strong" });
  });

  it("GivenASwitch_WhenTheResultIsAnAgent_ThenOnlyThatDispatches", async () => {
    const { service, created, dispatchNext } = await setup();

    await service.setWorker("ai", created.id, "me", "andy");
    expect(dispatchNext).not.toHaveBeenCalled();

    await service.setWorker("ai", created.id, "agent", "andy");
    expect(dispatchNext).toHaveBeenCalledWith("ai");
  });
});
