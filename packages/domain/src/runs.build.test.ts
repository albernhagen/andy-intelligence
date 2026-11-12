import {
  InMemoryCodeHost,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type NewTicket,
  type Run,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { branchFor } from "./builds";
import { RunService, type RunResult } from "./runs";
import { WorkflowExecutor, buildOutput } from "./test-executor";
import type { DomainError } from "./tickets";

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const NOW = new Date("2026-11-05T12:00:00.000Z");

describe("RunService build runs", () => {
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;
  let service: RunService;
  let projectId: string;

  const rejects = (p: Promise<unknown>, code: DomainError["code"]) =>
    expect(p).rejects.toMatchObject({ name: "DomainError", code });
  const ticketIn = async (stage: "backlog" | "ready", extra: Partial<NewTicket> = {}) => {
    const t = await tracker.createTicket(
      projectId,
      {
        type: "feature",
        title: "Board",
        body: "Andy can't see his tickets.",
        acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
        size: "S",
        sizeReason: "one screen",
        ...extra,
      },
      "andy",
    );
    if (stage === "backlog") return t;
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };
  const started = async (extra: Partial<NewTicket> = {}) => {
    const ticket = await ticketIn("ready", extra);
    const run = await service.start(projectId, ticket.id, "build");
    await service.context(run.id, run.executor!);
    return { ticket, run };
  };
  const report = (run: Run, result: Partial<RunResult>) =>
    service.report(run.id, run.executor!, {
      status: "succeeded",
      summary: "done",
      output: buildOutput,
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: 0.42,
      ...result,
    });

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker(() => NOW);
    runs = new InMemoryRunStore(() => NOW);
    service = new RunService(
      tracker,
      runs,
      new WorkflowExecutor(new InMemoryCodeHost([REPO])),
      () => NOW,
    );
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, { buildEnabled: true });
  });

  it("GivenBuildsNotEnabledForTheProject_WhenABuildIsStartedByHand_ThenNotBuildableWithTheReason", async () => {
    await tracker.updateProject(projectId, { buildEnabled: false });
    const t = await ticketIn("ready");
    await expect(service.start(projectId, t.id, "build")).rejects.toMatchObject({
      code: "not_buildable",
      message: expect.stringContaining("builds are off"),
    });
  });

  it("GivenABacklogTicket_WhenABuildIsStarted_ThenNotBuildable", async () => {
    const t = await ticketIn("backlog");
    await rejects(service.start(projectId, t.id, "build"), "not_buildable");
  });

  it("GivenATicketAssignedToAndy_WhenABuildIsStarted_ThenNotBuildableButRefineStillRuns", async () => {
    const mine = await ticketIn("ready", { overrides: { assignee: "me" } });
    await expect(service.start(projectId, mine.id, "build")).rejects.toMatchObject({
      code: "not_buildable",
      message: expect.stringContaining("assigned to Andy"),
    });
    const backlog = await ticketIn("backlog", { overrides: { assignee: "me" } });
    await tracker.updateTicket(
      projectId,
      backlog.id,
      { fields: { upNextRank: "0000000001" } },
      "andy",
    );
    expect((await service.start(projectId, backlog.id, "refine")).step).toBe("refine");
  });

  it("GivenAReadyEpic_WhenABuildIsStarted_ThenNotBuildable", async () => {
    const epic = await ticketIn("ready", {
      type: "epic",
      acceptanceCriteria: [],
      size: null,
      sizeReason: null,
    });
    await rejects(service.start(projectId, epic.id, "build"), "not_buildable");
  });

  it("GivenAReadyTicketBlockedByAnOpenTicket_WhenABuildIsStarted_ThenNotBuildable", async () => {
    const blocker = await ticketIn("backlog");
    const t = await ticketIn("ready", { blockedBy: [blocker.key] });
    await rejects(service.start(projectId, t.id, "build"), "not_buildable");
  });

  it("GivenAnMTicket_WhenABuildIsStarted_ThenItRunsOnOpusWithTheBuildCaps", async () => {
    const t = await ticketIn("ready", { size: "M" });
    const run = await service.start(projectId, t.id, "build");
    expect(run).toMatchObject({ tier: "strong", route: { model: "opus" }, maxTurns: 150 });
    expect(run.deadline).toBe("2026-11-05T13:30:00.000Z");
  });

  it("GivenAnSTicketPinnedToStrong_WhenABuildIsStarted_ThenTheOverrideWins", async () => {
    const t = await ticketIn("ready", { overrides: { tier: "strong" } });
    expect((await service.start(projectId, t.id, "build")).route.model).toBe("opus");
  });

  it("GivenABuildRun_WhenItFetchesItsContext_ThenItGetsTheTicketAndItsBranch", async () => {
    const t = await ticketIn("ready");
    const run = await service.start(projectId, t.id, "build");
    const context = await service.context(run.id, run.executor!);
    expect(context).toMatchObject({
      step: "build",
      ticket: { projectId, key: t.key, title: "Board" },
      branch: `agent/${t.key}/${run.id}`,
    });
    expect(context.prompt).toContain("You are the build step");
  });

  it("GivenABuildWithAPullRequest_WhenReported_ThenThePlanBranchAndLinkAreRecorded", async () => {
    const { ticket, run } = await started();
    const branch = branchFor(ticket.key, run.id);
    await report(run, { branch, pullRequest: `${REPO.url}/pull/9` });
    const done = (await runs.get(run.id))!;
    expect(done).toMatchObject({
      status: "succeeded",
      plan: buildOutput.plan,
      branch,
      links: { pullRequest: `${REPO.url}/pull/9` },
      tokensIn: 1000,
      costUsd: null,
      costIsEstimate: true,
      summary: "Adds the board.",
    });
    const comment = (await tracker.listEvents(projectId, ticket.id)).at(-1);
    expect(comment?.body).toContain(`Pull request: ${REPO.url}/pull/9`);
  });

  it("GivenAPullRequestInAnotherRepo_WhenReported_ThenItIsDroppedAndTheRunFails", async () => {
    const { ticket, run } = await started();
    await report(run, { pullRequest: "https://github.com/evil/repo/pull/1" });
    expect(await runs.get(run.id)).toMatchObject({ status: "failed", links: {} });
    expect((await tracker.getTicket(projectId, ticket.id))!.needsAttention).toBe(true);
    // Rejected by the control plane: flagged, not retried.
    expect(await runs.listForTicket(projectId, ticket.id)).toHaveLength(1);
  });

  it("GivenAMalformedResult_WhenReported_ThenTheRunFailsAndTheTicketIsFlagged", async () => {
    const { ticket, run } = await started();
    await report(run, { output: { summary: "x" }, pullRequest: `${REPO.url}/pull/9` });
    expect((await runs.get(run.id))!.error).toContain("rejected");
    expect((await tracker.getTicket(projectId, ticket.id))!.needsAttention).toBe(true);
  });

  it("GivenAReportedFailure_WhenItIsTheFirstAttempt_ThenItRetriesOnceThenFlagsAndKeepsTheBranch", async () => {
    const { ticket, run } = await started();
    const branch = branchFor(ticket.key, run.id);
    await report(run, { status: "failed", output: undefined, branch, summary: "tests failed" });
    expect((await runs.get(run.id))!.branch).toBe(branch);
    const retry = (await runs.listForTicket(projectId, ticket.id)).find((r) => r.attempt === 2)!;
    expect(retry).toMatchObject({ attempt: 2, retryOf: run.id, step: "build" });
    await service.context(retry.id, retry.executor!);
    const retryBranch = branchFor(ticket.key, retry.id);
    await report(retry, { status: "failed", output: undefined, branch: retryBranch });
    expect((await tracker.getTicket(projectId, ticket.id))!).toMatchObject({
      needsAttention: true,
      stage: "in_progress",
    });
    const events = await tracker.listEvents(projectId, ticket.id);
    expect(events.some((e) => e.body?.includes(`its branch ${retryBranch} is kept`))).toBe(true);
  });

  it("GivenAChangeToToolingFiles_WhenReported_ThenTheyAreRecordedAndNamedOnTheTicket", async () => {
    const { ticket, run } = await started();
    await report(run, { pullRequest: `${REPO.url}/pull/9`, toolingFiles: ["package.json"] });
    expect((await runs.get(run.id))!.toolingFiles).toEqual(["package.json"]);
    const comment = (await tracker.listEvents(projectId, ticket.id)).at(-1);
    expect(comment?.body).toContain("Changes tooling or dependency files");
  });

  it("GivenAForeignBranch_WhenReported_ThenItIsNotRecorded", async () => {
    const { run } = await started();
    await report(run, { branch: "main", pullRequest: `${REPO.url}/pull/9` });
    expect((await runs.get(run.id))!.branch).toBeNull();
  });

  it("GivenARunningBuild_WhenThePushGrantIsClaimedTwice_ThenOnlyTheFirstSucceeds", async () => {
    const { run } = await started();
    expect((await service.claimPushGrant(run.id, run.executor!)).pushGrantedAt).toBe(
      NOW.toISOString(),
    );
    await rejects(service.claimPushGrant(run.id, run.executor!), "forbidden");
  });

  it("GivenARefineRun_WhenAPushGrantIsClaimed_ThenForbidden", async () => {
    const t = await ticketIn("backlog");
    await tracker.updateTicket(projectId, t.id, { fields: { upNextRank: "0000000001" } }, "andy");
    const run = await service.start(projectId, t.id, "refine");
    await service.context(run.id, run.executor!);
    await rejects(service.claimPushGrant(run.id, run.executor!), "forbidden");
  });

  it("GivenAnotherWorkflowRun_WhenAPushGrantIsClaimed_ThenForbidden", async () => {
    const { run } = await started();
    await rejects(
      service.claimPushGrant(run.id, { ...run.executor!, externalId: "999" }),
      "forbidden",
    );
  });

  // ADR-0096: a repo registered to project A never pushes for a run of project B.
  it("GivenARunOfAnotherProjectDispatchedToThisRepo_WhenAPushGrantIsClaimed_ThenForbidden", async () => {
    const other = await tracker.createProject({ name: "BB", key: "BB", repos: ["albernhagen/bb"] });
    const executor = { repo: REPO.fullName, ref: "platform-executor", externalId: "77" };
    const created = await runs.create({
      projectId: other.id,
      ticketId: "t1",
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: "fast",
      deadline: null,
      prompt: "x",
      maxTurns: 1,
    });
    await runs.update(created.id, { status: "running", executor }, ["queued"]);
    await rejects(service.claimPushGrant(created.id, executor), "forbidden");
    await rejects(service.context(created.id, executor), "forbidden");
  });

  it("GivenAQueuedBuild_WhenAPushGrantIsClaimed_ThenRunFinished", async () => {
    const t = await ticketIn("ready");
    const run = await service.start(projectId, t.id, "build");
    await rejects(service.claimPushGrant(run.id, run.executor!), "run_finished");
  });
});
