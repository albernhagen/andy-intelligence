import { InMemoryCodeHost } from "@andy/contracts";
import { executorContract } from "@andy/contracts/testing";
import { describe, expect, it } from "vitest";
import { CLAUDE_EXECUTOR_REF, ClaudeCodeActionsExecutor } from "./executor";

const repo = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};

const request = (runId: string, billingType: "subscription" | "pay_per_use" = "subscription") => ({
  runId,
  projectRef: repo.fullName,
  ticketRef: "AI-1",
  step: "refine" as const,
  route: { harness: "claude-code" as const, provider: "claude-sub" as const, model: "sonnet" },
  billingType,
  instructions: "Read the ticket.",
  callbackUrl: null,
});

executorContract("claude-code on actions (in-memory code host)", async () => ({
  executor: new ClaudeCodeActionsExecutor(new InMemoryCodeHost([repo])),
  request,
}));

describe("ClaudeCodeActionsExecutor", () => {
  it("GivenASubscriptionProvider_WhenStarted_ThenOnlyTheRunIdAndCredentialKindAreSent", async () => {
    const host = new InMemoryCodeHost([repo]);
    const handle = await new ClaudeCodeActionsExecutor(host).start(request("r1"));
    const dispatched = host.workflowRuns.get(handle.externalId);
    expect(dispatched?.workflow).toBe("agent-run.yml");
    expect(dispatched?.inputs).toEqual({ run_id: "r1", credential: "subscription" });
    expect(handle.executor).toEqual({
      repo: repo.fullName,
      ref: CLAUDE_EXECUTOR_REF,
      externalId: handle.externalId,
    });
  });

  it("GivenAPayPerUseProvider_WhenStarted_ThenTheApiKeyCredentialIsChosen", async () => {
    const host = new InMemoryCodeHost([repo]);
    const handle = await new ClaudeCodeActionsExecutor(host).start(request("r2", "pay_per_use"));
    expect(host.workflowRuns.get(handle.externalId)?.inputs.credential).toBe("api_key");
  });

  it("GivenTheAppIsNotInstalled_WhenStarted_ThenItFails", async () => {
    const executor = new ClaudeCodeActionsExecutor(new InMemoryCodeHost([]));
    await expect(executor.start(request("r3"))).rejects.toThrow(/isn.t installed/);
  });

  it("GivenACancelledWorkflowRun_WhenStatusIsRead_ThenTheRunIsCancelled", async () => {
    const executor = new ClaudeCodeActionsExecutor(new InMemoryCodeHost([repo]));
    const handle = await executor.start(request("r4"));
    await executor.cancel(handle);
    expect((await executor.status(handle)).status).toBe("cancelled");
  });
});
