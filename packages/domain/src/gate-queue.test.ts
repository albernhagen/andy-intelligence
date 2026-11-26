import {
  InMemoryCodeHost,
  InMemoryMergeQueueStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type CodeHostEvent,
  type HeadCheck,
  type PullRequest,
  type Repo,
  type Run,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PullRequestGate } from "./gate-service";
import { MAIN_RED_WAKE_MS, MAX_MAIN_RED_HOLD_MS, MergeQueue } from "./merge-queue";
import { TicketService } from "./tickets";

/**
 * AI-110: the gate as the merge queue's judge for build agents' PRs: it offers a clean or behind
 * PR, asks for a sync tick when the queue's head is behind, merges pinned to the synced head,
 * flags the ticket when checks fail after the sync, and never merges a head it already tried.
 */

const REPO: Repo = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const REQUIRED = ["check", "adversarial-review", "security-review"];
const check = (name: string, conclusion: "success" | "failure" = "success"): HeadCheck => ({
  name,
  status: "completed",
  conclusion,
  sourceId: "15368",
});
const MAIN_KEY = `${REPO.fullName.toLowerCase()}#main`;

describe("PullRequestGate with the merge queue (AI-110)", () => {
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;
  let host: InMemoryCodeHost;
  let tickets: TicketService;
  let queue: MergeQueue;
  let syncTick: ReturnType<typeof vi.fn<(projectId: string) => Promise<unknown>>>;
  let projectId: string;
  let prNumber: number;
  let mainTip: number;
  const now = () => new Date("2026-11-23T22:00:00.000Z");

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker();
    runs = new InMemoryRunStore(now);
    host = new InMemoryCodeHost([REPO], now);
    host.requiredChecks = REQUIRED.map((name) => ({ name, sourceId: "15368" }));
    mainTip = 1;
    host.branches.set(MAIN_KEY, tip(mainTip));
    // A merge moves main: every other open head now lacks it.
    const merge = host.mergePullRequest.bind(host);
    host.mergePullRequest = async (repo, number, sha) => {
      const squash = await merge(repo, number, sha);
      host.branches.set(MAIN_KEY, tip(++mainTip));
      for (const p of host.pullRequests.values()) {
        if (p.pullRequest.state === "open") host.behindDefault.add(p.pullRequest.headSha);
      }
      return squash;
    };
    tickets = new TicketService(tracker, null, null, now);
    queue = new MergeQueue(new InMemoryMergeQueueStore(), host, now);
    syncTick = vi.fn<(projectId: string) => Promise<unknown>>(async () => true);
    prNumber = 40;
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, { mergeMode: "all-clean" });
  });

  function tip(n: number) {
    return n.toString(16).padStart(40, "e");
  }

  const gate = () =>
    new PullRequestGate(host, tracker, runs, tickets, now, null, null, null, queue, syncTick);

  async function readyTicket(title: string): Promise<Ticket> {
    const t = await tracker.createTicket(projectId, { type: "feature", title }, "andy");
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready_for_review", forced: true, reason: null } },
      "andy",
    );
  }

  /** A succeeded build run whose PR into main is open with every check green. */
  async function agentPr(ticket: Ticket): Promise<{ run: Run; pr: PullRequest }> {
    const number = ++prNumber;
    const created = await runs.create({
      projectId,
      ticketId: ticket.id,
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: "fast",
      deadline: null,
    });
    const branch = `agent/${ticket.key}/${created.id}`;
    const url = `${REPO.url}/pull/${number}`;
    await runs.update(created.id, { status: "running" }, ["queued"]);
    const run = await runs.update(
      created.id,
      {
        status: "succeeded",
        branch,
        links: { pullRequest: url },
        verification: [{ command: "pnpm test", passed: true, output: "12 passed" }],
      },
      ["running"],
    );
    const pr: PullRequest = {
      number,
      state: "open",
      draft: false,
      title: ticket.title,
      bodyFirstLine: "",
      fromFork: false,
      intoDefaultBranch: true,
      headRef: branch,
      headSha: `head${number}`,
      baseRef: "main",
      url,
      labels: [],
    };
    host.pullRequests.set(number, {
      pullRequest: pr,
      files: { items: [{ path: "apps/web/src/a.tsx", previousPath: null }], complete: true },
      checks: { items: REQUIRED.map((n) => check(n)), complete: true },
      commits: { items: [], complete: true },
    });
    return { run, pr };
  }

  const opened = (pr: PullRequest): CodeHostEvent => ({
    kind: "pull_request",
    deliveryId: `d-open-${pr.number}`,
    projectId,
    repo: REPO.fullName,
    action: "opened",
    receivedAt: now().toISOString(),
    pullRequest: pr,
  });

  const checkDone = (number: number, sha: string): CodeHostEvent => ({
    kind: "check_run",
    deliveryId: `d-check-${number}-${sha}`,
    projectId,
    repo: REPO.fullName,
    action: "completed",
    receivedAt: now().toISOString(),
    checkRun: {
      id: "1",
      name: "check",
      status: "completed",
      conclusion: "success",
      headSha: sha,
      url: `${REPO.url}/runs/1`,
      pullRequestNumbers: [number],
    },
  });

  /** The sync task merged main into the PR: a new head that contains main. */
  function synced(number: number, sha: string, checks: HeadCheck[]) {
    const fake = host.pullRequests.get(number)!;
    fake.pullRequest.headSha = sha;
    fake.checks = { items: checks, complete: true };
  }

  const project = async () => (await tracker.getProject(projectId))!;

  it("GivenTwoCleanAgentPrsOnOneMain_WhenBothAssessed_ThenOneMergesAndTheOtherGetsASyncTickThenMergesPinnedToItsSyncedHead", async () => {
    const a = await agentPr(await readyTicket("A"));
    const b = await agentPr(await readyTicket("B"));

    expect(await gate().apply(opened(a.pr), await project())).toEqual([
      expect.objectContaining({ result: "merged", pr: a.pr.number }),
    ]);
    expect(await gate().apply(opened(b.pr), await project())).toEqual([
      expect.objectContaining({ result: "queued", pr: b.pr.number }),
    ]);
    expect(syncTick).toHaveBeenCalledWith(projectId);
    expect(host.merges.map((m) => m.number)).toEqual([a.pr.number]);

    synced(
      b.pr.number,
      "synced-b",
      REQUIRED.map((n) => check(n)),
    );
    const [result] = await gate().apply(checkDone(b.pr.number, "synced-b"), await project());

    expect(result).toMatchObject({ result: "merged", pr: b.pr.number });
    expect(host.merges).toEqual([
      { fullName: REPO.fullName, number: a.pr.number, sha: a.pr.headSha },
      { fullName: REPO.fullName, number: b.pr.number, sha: "synced-b" },
    ]);
    expect((await queue.state(REPO.fullName)).entries).toEqual([]);
  });

  it("GivenAQueuedAgentPrWhoseChecksFailAfterItsSync_WhenTheCheckArrives_ThenItIsDroppedAndItsTicketNeedsAndy", async () => {
    const ticket = await readyTicket("A");
    const { pr } = await agentPr(ticket);
    host.behindDefault.add(pr.headSha);
    await gate().apply(opened(pr), await project());
    expect((await queue.state(REPO.fullName)).entries.map((e) => e.number)).toEqual([pr.number]);

    synced(pr.number, "synced-a", [
      check("check", "failure"),
      ...REQUIRED.slice(1).map((n) => check(n)),
    ]);
    // The gate itself doesn't offer a failing PR; the queue judges it from the webhook.
    await queue.advanceFor(REPO.fullName, [pr.number], false);

    expect(host.merges).toEqual([]);
    expect((await queue.state(REPO.fullName)).entries).toEqual([]);
    expect((await tracker.getTicket(projectId, ticket.id))?.needsAttention).toBe(true);
    const comments = (await tracker.listEvents(projectId, ticket.id)).filter(
      (e) => e.kind === "comment",
    );
    expect(comments.some((c) => c.body?.includes("merge queue dropped PR"))).toBe(true);
  });

  it("GivenACleanAgentPrWhileMainsRequiredCheckFailed_WhenAssessed_ThenQueuedWithMainRedAndMergedOnceMainIsGreen", async () => {
    const mainChecks = { conclusion: "failure" as "success" | "failure" };
    const listHeadChecks = host.listHeadChecks.bind(host);
    host.listHeadChecks = async (repo, sha) =>
      sha === tip(mainTip)
        ? { items: [check("check", mainChecks.conclusion)], complete: true }
        : listHeadChecks(repo, sha);
    let clock = now();
    queue = new MergeQueue(new InMemoryMergeQueueStore(), host, () => clock);
    const { run, pr } = await agentPr(await readyTicket("A"));

    expect(await gate().apply(opened(pr), await project())).toEqual([
      expect.objectContaining({ result: "queued", pr: pr.number }),
    ]);
    expect(host.merges).toEqual([]);
    expect((await runs.get(run.id))?.verdictReasons).toEqual(["main_red"]);
    expect((await queue.state(REPO.fullName)).mainRed?.checks).toEqual(["check"]);

    mainChecks.conclusion = "success";
    // Main's own check finishing a minute on: a completed check naming no PR.
    clock = new Date(clock.getTime() + MAIN_RED_WAKE_MS);
    await queue.advanceFor(REPO.fullName, [], false, true);
    expect(host.merges.map((m) => m.number)).toEqual([pr.number]);
    expect((await queue.state(REPO.fullName)).mainRed).toBeNull();
  });

  it("GivenAnAgentPrHeldWhileMainIsRedPastTheCap_WhenAnEventArrives_ThenItsTicketNeedsAndyOnceAndThePrStaysQueued", async () => {
    let clock = now();
    queue = new MergeQueue(new InMemoryMergeQueueStore(), host, () => clock);
    const listHeadChecks = host.listHeadChecks.bind(host);
    host.listHeadChecks = async (repo, sha) =>
      sha === tip(mainTip)
        ? { items: [check("check", "failure")], complete: true }
        : listHeadChecks(repo, sha);
    const ticket = await readyTicket("A");
    const { pr } = await agentPr(ticket);
    await gate().apply(opened(pr), await project());

    clock = new Date(clock.getTime() + MAX_MAIN_RED_HOLD_MS + 1);
    await queue.advanceFor(REPO.fullName, [], false);
    await queue.advanceFor(REPO.fullName, [], false, true);

    expect(host.merges).toEqual([]);
    expect((await queue.state(REPO.fullName)).entries.map((e) => e.number)).toEqual([pr.number]);
    expect((await tracker.getTicket(projectId, ticket.id))?.needsAttention).toBe(true);
    const notes = (await tracker.listEvents(projectId, ticket.id)).filter(
      (e) => e.kind === "comment" && e.body?.includes("merge queue"),
    );
    expect(notes.map((n) => n.body)).toEqual([
      expect.stringMatching(/^Needs you: the merge queue is holding PR #\d+: .*failing: check/),
    ]);
  });

  it("GivenAHeadTheGateAlreadyTriedToMerge_WhenTheQueueJudgesItClean_ThenItIsNotMergedAgain", async () => {
    const { run, pr } = await agentPr(await readyTicket("A"));
    await runs.update(run.id, { mergeAttemptedSha: pr.headSha }, ["succeeded"]);

    const [result] = await gate().apply(opened(pr), await project());

    expect(result).toMatchObject({ result: "assessed" });
    expect(host.merges).toEqual([]);
    expect((await queue.state(REPO.fullName)).entries).toEqual([]);
  });
});
