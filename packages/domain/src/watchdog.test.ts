import {
  InMemoryCodeHost,
  InMemoryRunStore,
  InMemoryWatchdogQueue,
  InMemoryWorkTracker,
  type Executor,
  type RunHandle,
  type RunReport,
  type RunRequest,
  type WorkflowRun,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunService } from "./runs";
import { afterFailure, deadlineAction, MAX_RUN_ATTEMPTS } from "./watchdog";

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const START = new Date("2026-11-04T12:00:00.000Z");
const AFTER_DEADLINE = new Date("2026-11-04T12:46:00.000Z");
const REF = "albernhagen/andy-intelligence/.github/workflows/claude-executor.yml@refs/heads/main";

/** Dispatches workflows on the fake code host and reads their status back, like the adapter. */
class WorkflowExecutor implements Executor {
  constructor(private readonly host: InMemoryCodeHost) {}
  async start(req: RunRequest): Promise<RunHandle> {
    const d = await this.host.dispatchWorkflow(req.projectRef, "agent-run.yml", {
      run_id: req.runId,
    });
    if (!d) throw new Error("not installed");
    return {
      runId: req.runId,
      externalId: d.id,
      url: d.url,
      executor: { repo: req.projectRef, ref: REF, externalId: d.id },
    };
  }
  async status(handle: RunHandle): Promise<RunReport> {
    const run = await this.host.getWorkflowRun(REPO.fullName, handle.externalId);
    const status =
      run?.status === "queued"
        ? "queued"
        : run?.status === "in_progress"
          ? "running"
          : run?.conclusion === "success"
            ? "succeeded"
            : run?.conclusion === "cancelled"
              ? "cancelled"
              : "failed";
    return {
      runId: handle.runId,
      status,
      summary: null,
      pullRequestUrl: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      costIsEstimate: false,
    };
  }
  async cancel(handle: RunHandle): Promise<void> {
    await this.host.cancelWorkflowRun(REPO.fullName, handle.externalId);
  }
}

describe("deadlineAction", () => {
  it("GivenAnExecutorThatSucceeded_WhenDecided_ThenHeal", () => {
    expect(deadlineAction("succeeded")).toEqual({ kind: "heal" });
  });

  it("GivenAnExecutorStillGoing_WhenDecided_ThenCancelItAndEndTheRun", () => {
    for (const s of ["queued", "running"] as const) {
      expect(deadlineAction(s)).toMatchObject({ kind: "end", status: "cancelled", cancel: true });
    }
  });

  it("GivenAnExecutorThatFailedOrWasKilled_WhenDecided_ThenEndTheRunWithoutCancelling", () => {
    expect(deadlineAction("failed")).toMatchObject({ status: "failed", cancel: false });
    expect(deadlineAction("cancelled")).toMatchObject({ status: "cancelled", cancel: false });
  });

  it("GivenNoExecutorToAsk_WhenDecided_ThenEndItFailed", () => {
    expect(deadlineAction(null)).toMatchObject({ kind: "end", status: "failed", cancel: false });
  });
});

describe("afterFailure", () => {
  it("GivenAFirstAttempt_WhenItFails_ThenRetry", () => {
    expect(afterFailure({ attempt: 1 })).toBe("retry");
  });

  it("GivenTheLastAttempt_WhenItFails_ThenFlag", () => {
    expect(afterFailure({ attempt: MAX_RUN_ATTEMPTS })).toBe("flag");
  });
});

describe("RunService watchdog", () => {
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;
  let host: InMemoryCodeHost;
  let queue: InMemoryWatchdogQueue;
  let service: RunService;
  let now: Date;
  let projectId: string;
  let ticketId: string;

  const workflow = (id: string) => host.workflowRuns.get(id)!;
  const finishWorkflow = (id: string, conclusion: WorkflowRun["conclusion"]) => {
    workflow(id).run = { ...workflow(id).run, status: "completed", conclusion };
  };
  const ticket = async () => (await tracker.getTicket(projectId, ticketId))!;
  const lastComment = async () => (await tracker.listEvents(projectId, ticketId)).at(-1)?.body;
  const failedReport = {
    status: "failed" as const,
    summary: "Agent stopped: error_max_turns",
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
  };

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    now = START;
    tracker = new InMemoryWorkTracker(() => now);
    runs = new InMemoryRunStore(() => now);
    host = new InMemoryCodeHost([REPO]);
    queue = new InMemoryWatchdogQueue();
    service = new RunService(tracker, runs, new WorkflowExecutor(host), () => now, queue);
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    ticketId = (await tracker.createTicket(projectId, { type: "feature", title: "Board" }, "andy"))
      .id;
    await tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { upNextRank: "0000000001" } },
      "andy",
    );
  });

  it("GivenADispatchedRun_WhenStarted_ThenOneCheckIsQueuedAtItsDeadline", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    expect(run).toMatchObject({ attempt: 1, retryOf: null });
    expect([...queue.checks.values()]).toEqual([{ runId: run.id, at: run.deadline }]);
  });

  it("GivenTheQueueIsDown_WhenStarted_ThenTheRunIsStillDispatched", async () => {
    queue.schedule = async () => {
      throw new Error("queue unavailable");
    };
    await expect(service.start(projectId, ticketId, "refine")).resolves.toMatchObject({
      status: "queued",
    });
  });

  it("GivenARunThatReported_WhenItsCheckArrives_ThenSettledAndNothingChanges", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    const caller = (await runs.get(run.id))!.executor!;
    await service.report(run.id, caller, { ...failedReport, status: "succeeded", summary: "ok" });
    const before = await runs.get(run.id);
    now = AFTER_DEADLINE;
    expect(await service.checkDeadline(run.id)).toBe("settled");
    expect(await runs.get(run.id)).toEqual(before);
  });

  it("GivenACheckBeforeTheDeadline_WhenItArrives_ThenEarlyAndTheRunIsUntouched", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    expect(await service.checkDeadline(run.id)).toBe("early");
    expect((await runs.get(run.id))?.status).toBe("queued");
    expect(workflow("1").run.status).toBe("queued");
  });

  it("GivenAnUnknownRun_WhenItsCheckArrives_ThenUnknown", async () => {
    expect(await service.checkDeadline("nope")).toBe("unknown");
  });

  it("GivenAWorkflowThatSucceededWithoutReporting_WhenTheCheckArrives_ThenTheRunIsHealed", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    finishWorkflow("1", "success");
    now = AFTER_DEADLINE;
    expect(await service.checkDeadline(run.id)).toBe("healed");
    expect(await runs.get(run.id)).toMatchObject({
      status: "succeeded",
      endedAt: AFTER_DEADLINE.toISOString(),
      error: expect.stringContaining("report never arrived"),
    });
    expect(host.workflowRuns.size).toBe(1);
    expect((await ticket()).needsAttention).toBe(false);
  });

  it("GivenAKilledWorkflow_WhenTheCheckArrives_ThenTheRunIsCancelledAndRetriedOnce", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    finishWorkflow("1", "cancelled");
    now = AFTER_DEADLINE;
    expect(await service.checkDeadline(run.id)).toBe("retried");
    expect((await runs.get(run.id))?.status).toBe("cancelled");
    const [retry] = await runs.listActive(projectId);
    expect(retry).toMatchObject({ attempt: 2, retryOf: run.id, executor: { externalId: "2" } });
    expect(queue.checks.get(retry!.id)).toEqual({ runId: retry!.id, at: retry!.deadline });
    expect(await lastComment()).toMatch(/^Retrying the refine run \(attempt 2 of 2\)/);
  });

  it("GivenAWorkflowStillRunningAtItsDeadline_WhenTheCheckArrives_ThenItIsStoppedAndRetried", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    workflow("1").run = { ...workflow("1").run, status: "in_progress" };
    now = AFTER_DEADLINE;
    expect(await service.checkDeadline(run.id)).toBe("retried");
    expect(workflow("1").run.conclusion).toBe("cancelled");
    expect(await runs.get(run.id)).toMatchObject({
      status: "cancelled",
      error: "the run passed its deadline",
    });
  });

  it("GivenACheckDeliveredTwice_WhenTheSecondArrives_ThenSettledAndNoSecondRetry", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    finishWorkflow("1", "failure");
    now = AFTER_DEADLINE;
    await service.checkDeadline(run.id);
    expect(await service.checkDeadline(run.id)).toBe("settled");
    expect(host.workflowRuns.size).toBe(2);
  });

  it("GivenARetryThatAlsoFails_WhenItsCheckArrives_ThenNeedsYouAndNoThirdAttempt", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    finishWorkflow("1", "failure");
    now = AFTER_DEADLINE;
    await service.checkDeadline(run.id);
    const [retry] = await runs.listActive(projectId);
    finishWorkflow("2", "failure");
    now = new Date("2026-11-04T13:40:00.000Z");
    expect(await service.checkDeadline(retry!.id)).toBe("flagged");
    expect(host.workflowRuns.size).toBe(2);
    expect(await runs.listActive(projectId)).toEqual([]);
    expect((await ticket()).needsAttention).toBe(true);
    expect(await lastComment()).toMatch(/^Needs you: The refine run failed without reporting/);
  });

  it("GivenAFirstRunReportsAFailure_WhenRecorded_ThenItIsRetried", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    const caller = (await runs.get(run.id))!.executor!;
    expect(await service.report(run.id, caller, failedReport)).toBe("recorded");
    const [retry] = await runs.listActive(projectId);
    expect(retry).toMatchObject({ attempt: 2, retryOf: run.id });
  });

  it("GivenARetryReportsAFailure_WhenRecorded_ThenNeedsYou", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    await service.report(run.id, (await runs.get(run.id))!.executor!, failedReport);
    const [retry] = await runs.listActive(projectId);
    await service.report(retry!.id, (await runs.get(retry!.id))!.executor!, failedReport);
    expect(await runs.listActive(projectId)).toEqual([]);
    expect((await ticket()).needsAttention).toBe(true);
  });

  it("GivenTheRetryCommentFails_WhenTheRetryIsDispatched_ThenRetriedAndNotFlagged", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    finishWorkflow("1", "failure");
    const addComment = tracker.addComment.bind(tracker);
    tracker.addComment = async (p, t, body, actor) => {
      if (body.startsWith("Retrying")) throw new Error("firestore unavailable");
      return addComment(p, t, body, actor);
    };
    now = AFTER_DEADLINE;
    expect(await service.checkDeadline(run.id)).toBe("retried");
    expect((await ticket()).needsAttention).toBe(false);
  });

  it("GivenTheRetryCantStartAfterAReportedFailure_WhenReported_ThenStillRecordedAndFlagged", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    host.failDispatch = new Error("GitHub is down");
    const caller = (await runs.get(run.id))!.executor!;
    expect(await service.report(run.id, caller, failedReport)).toBe("recorded");
    expect((await runs.get(run.id))?.status).toBe("failed");
    expect((await ticket()).needsAttention).toBe(true);
  });

  it("GivenTheRetryCantStart_WhenTheCheckArrives_ThenNeedsYouWithTheReason", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    finishWorkflow("1", "failure");
    host.failDispatch = new Error("Resource not accessible by integration");
    now = AFTER_DEADLINE;
    expect(await service.checkDeadline(run.id)).toBe("flagged");
    expect((await ticket()).needsAttention).toBe(true);
    expect(await lastComment()).toMatch(/the retry couldn't start: .*not accessible/);
  });

  it("GivenNoExecutor_WhenTheCheckArrives_ThenTheRunFailsAndTheTicketNeedsYou", async () => {
    const run = await service.start(projectId, ticketId, "refine");
    now = AFTER_DEADLINE;
    const offline = new RunService(tracker, runs, null, () => now, queue);
    expect(await offline.checkDeadline(run.id)).toBe("flagged");
    expect(await runs.get(run.id)).toMatchObject({
      status: "failed",
      error: "the run couldn't be checked: no executor",
    });
    expect((await ticket()).needsAttention).toBe(true);
  });
});
