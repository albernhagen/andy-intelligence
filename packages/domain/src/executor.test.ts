import { InMemoryWorkTracker, type ExecutorKind } from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import { executorView, resolveExecutor, wantedExecutor } from "./executor";
import { LOCAL_RUNNER_AWAY, statusLine, type StatusInput } from "./status-line";
import { TicketService } from "./tickets";

const ticket = (executor?: ExecutorKind) => ({ overrides: executor ? { executor } : {} });
const project = (executor: ExecutorKind) => ({ executor });

describe("resolveExecutor", () => {
  it("GivenNoOverride_WhenTheDefaultIsActions_ThenActionsWhateverTheRunner", () => {
    expect(resolveExecutor(ticket(), project("actions"), true)).toBe("actions");
    expect(resolveExecutor(ticket(), project("actions"), false)).toBe("actions");
  });

  it("GivenALocalDefault_WhenARunnerIsPresent_ThenLocal", () => {
    expect(resolveExecutor(ticket(), project("local"), true)).toBe("local");
  });

  it("GivenALocalDefault_WhenNoRunnerIsPresent_ThenItFallsBackToActions", () => {
    expect(resolveExecutor(ticket(), project("local"), false)).toBe("actions");
  });

  it("GivenALocalOverride_WhenNoRunnerIsPresent_ThenItWaits", () => {
    expect(resolveExecutor(ticket("local"), project("actions"), false)).toBe("wait");
    expect(resolveExecutor(ticket("local"), project("local"), false)).toBe("wait");
  });

  it("GivenAnActionsOverride_WhenTheDefaultIsLocalAndARunnerIsPresent_ThenActions", () => {
    expect(resolveExecutor(ticket("actions"), project("local"), true)).toBe("actions");
  });
});

describe("executorView", () => {
  it("GivenNoOverride_WhenViewed_ThenItFollowsTheProjectAndOverrideIsNull", () => {
    expect(executorView(ticket(), project("local"), false)).toEqual({
      executor: "local",
      override: null,
      projectDefault: "local",
      next: "actions",
      runnerPresent: false,
    });
  });

  it("GivenAnOverride_WhenViewed_ThenTheOverrideWins", () => {
    expect(wantedExecutor(ticket("local"), project("actions"))).toBe("local");
    expect(executorView(ticket("local"), project("actions"), false)).toEqual({
      executor: "local",
      override: "local",
      projectDefault: "actions",
      next: "wait",
      runnerPresent: false,
    });
  });
});

describe("TicketService.setExecutor", () => {
  async function setup() {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "AI", key: "AI" });
    const dispatchNext = vi.fn(async () => null);
    const service = new TicketService(tracker, null, dispatchNext);
    const created = await tracker.createTicket(
      "ai",
      { title: "T", overrides: { tier: "strong" } },
      "andy",
    );
    return { tracker, service, created, dispatchNext };
  }

  it("GivenAPinnedTier_WhenTheExecutorIsSetAndCleared_ThenOnlyTheExecutorChanges", async () => {
    const { tracker, service, created, dispatchNext } = await setup();

    const view = await service.setExecutor("ai", created.id, "local", "user:uid-1");
    expect(view).toMatchObject({ executor: "local", override: "local", projectDefault: "actions" });
    expect((await tracker.getTicket("ai", created.id))?.overrides).toEqual({
      tier: "strong",
      executor: "local",
    });
    expect(dispatchNext).toHaveBeenCalledWith("ai");

    await service.setExecutor("ai", created.id, null, "user:uid-1");
    expect((await tracker.getTicket("ai", created.id))?.overrides).toEqual({ tier: "strong" });
  });

  it("GivenAnAgent_WhenItSetsTheExecutor_ThenForbiddenAndNothingChanges", async () => {
    const { tracker, service, created } = await setup();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(service.setExecutor("ai", created.id, "local", "agent:run-1")).rejects.toThrow(
      "only the owner can choose where a ticket's runs execute",
    );
    expect((await tracker.getTicket("ai", created.id))?.overrides.executor).toBeUndefined();
  });

  it("GivenALocalOverride_WhenStatusIsRead_ThenItShowsTheExecutor", async () => {
    const { service, created } = await setup();
    await service.setExecutor("ai", created.id, "local", "andy");

    expect((await service.status(created.key)).executor).toEqual({
      executor: "local",
      override: "local",
      projectDefault: "actions",
      next: "wait",
      runnerPresent: false,
    });
  });
});

describe("status line executor", () => {
  const base: StatusInput = {
    stage: "ready",
    archived: false,
    needsAttention: false,
    dorMet: true,
    openQuestions: 0,
    run: null,
    pr: null,
    blockedBy: [],
    queuePosition: 1,
  };
  const NOW = new Date("2026-11-11T12:00:00.000Z");

  it("GivenAReadyLocalTicket_WhenComputed_ThenItSaysItRunsLocally", () => {
    expect(statusLine({ ...base, executor: "local" }, NOW).text).toBe(
      "Ready · next in the queue · runs locally",
    );
  });

  it("GivenAReadyTicketWaitingForTheRunner_WhenComputed_ThenItSaysTheRunnerIsAway", () => {
    expect(statusLine({ ...base, executor: "wait" }, NOW).text).toBe(LOCAL_RUNNER_AWAY);
  });

  it("GivenAnActionsTicket_WhenComputed_ThenTheLineIsUnchanged", () => {
    expect(statusLine({ ...base, executor: "actions" }, NOW).text).toBe(
      "Ready · next in the queue",
    );
  });
});
