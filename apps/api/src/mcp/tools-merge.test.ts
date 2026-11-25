import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryMergeQueueStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type HeadCheck,
  type MergeMode,
  type PullRequest,
} from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sign } from "@octokit/webhooks-methods";
import { describe, expect, it } from "vitest";
import { MergeQueue } from "@andy/domain";
import { createApp } from "../app";
import { WEBHOOK_PATH } from "../github/webhooks";
import type { TokenVerifier } from "../auth";
import { MERGE_PR_HOURLY_CAP, PullRequestMerger } from "../merge";
import { ownerOnlyAccess } from "../project-access";
import { ClientMetadataResolver } from "./client-metadata";
import { mcpCaller } from "./test-client";
import { run } from "./tools";
import { registerMergeTools } from "./tools-merge";

/**
 * AI-220: MCP `merge_pr` end to end: the endpoint, the merge service and the fake code host. Each
 * acceptance criterion has a test: merges when the mode allows, every reason when not, a moved
 * head doesn't merge, a non-owner is refused, and the hourly cap.
 */

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;
const REPO = "albernhagen/andy-intelligence";
const REQUIRED = ["ci", "adversarial-review", "security-review"];
const REVIEWER = "15368";
const HEAD = "a".repeat(40);

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

const passed: HeadCheck[] = REQUIRED.map((name) => ({
  name,
  status: "completed",
  conclusion: "success",
  sourceId: REVIEWER,
}));

async function setup(opts: { mode?: MergeMode | null } = {}) {
  const tracker = new InMemoryWorkTracker();
  const grants = new InMemoryOAuthGrantStore();
  const host = new InMemoryCodeHost([
    { fullName: REPO, defaultBranch: "main", private: false, url: `https://github.com/${REPO}` },
  ]);
  const connections = new InMemoryCodeHostConnectionStore();
  await connections.save({
    appId: "1",
    slug: "andy-intelligence",
    clientId: "Iv1",
    owner: "albernhagen",
    privateKey: "PEM",
    webhookSecret: "whs",
    connectedAt: "2026-11-03T00:00:00.000Z",
  });
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier,
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    github: {
      publicUrl: PUBLIC_URL,
      connections,
      events: new InMemoryCodeEventLog(),
      codeHostFor: () => host,
    },
  });
  await tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: [REPO] });
  const mode = opts.mode === undefined ? "all-clean" : opts.mode;
  await tracker.updateProject("ai", { mergeMode: mode });
  const ticket = await tracker.createTicket(
    "ai",
    { title: "Merge through MCP", type: "feature" },
    "andy",
  );
  await tracker.updateTicket(
    "ai",
    ticket.id,
    { stage: { to: "ready_for_review", reason: null } },
    "andy",
  );

  const pullRequest: PullRequest = {
    number: 7,
    state: "open",
    draft: false,
    title: `${ticket.key}: Merge through MCP`,
    bodyFirstLine: `https://ai.andybernhagen.com/p/ai/t/${ticket.key}`,
    fromFork: false,
    intoDefaultBranch: true,
    headRef: "m4/merge-pr",
    headSha: HEAD,
    baseRef: "main",
    url: `https://github.com/${REPO}/pull/7`,
    labels: [],
  };
  host.requiredChecks = REQUIRED.map((name) => ({ name, sourceId: REVIEWER }));
  host.pullRequests.set(7, {
    pullRequest,
    files: { items: [{ path: "apps/api/src/merge.ts", previousPath: null }], complete: true },
    checks: { items: passed, complete: true },
    commits: { items: [], complete: true },
  });
  // The PR-opened webhook's link, recorded from GitHub's event.
  await tracker.linkPullRequest(
    "ai",
    ticket.id,
    { number: 7, url: pullRequest.url, state: "open" },
    "system",
  );
  const call = await mcpCaller(app, grants, RESOURCE);
  const mergePr = (args: Record<string, unknown> = {}) =>
    call("merge_pr", { project: "AI", repo: REPO, number: 7, ...args });
  /** A signed check_run completed delivery for PR `number` at `sha` (AI-110: moves the queue). */
  const checkHook = async (number: number, sha: string, id: string) => {
    const body = JSON.stringify({
      action: "completed",
      repository: { full_name: REPO },
      check_run: {
        id: 1,
        name: "ci",
        status: "completed",
        conclusion: "success",
        head_sha: sha,
        html_url: `https://github.com/${REPO}/runs/1`,
        pull_requests: [{ number }],
      },
    });
    return app.request(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "check_run",
        "x-github-delivery": id,
        "x-hub-signature-256": await sign("whs", body),
      },
      body,
    });
  };
  return { app, tracker, host, ticket, call, mergePr, checkHook, pr: host.pullRequests.get(7)! };
}

describe("merge_pr (AI-220)", () => {
  it("GivenACleanPrAndAllCleanMode_WhenMergePrIsCalled_ThenItMergesAtTheAssessedHeadAndRecordsModeAndVerdict", async () => {
    const t = await setup();
    const res = await t.mergePr();
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      merged: true,
      verdict: "merge",
      mode: "all-clean",
      reasons: [],
      headSha: HEAD,
      ticket: t.ticket.key,
    });
    expect(t.host.merges).toEqual([{ fullName: REPO, number: 7, sha: HEAD }]);
    const events = await t.tracker.listEvents("ai", t.ticket.id);
    const record = events.find((e) => e.kind === "comment");
    expect(record?.actor).toBe("user:andy");
    expect(record?.body).toContain("merge mode all-clean");
    expect(record?.body).toContain("verdict merge");
    expect(record?.body).toContain("asked by user:andy");
  });

  it("GivenAPrTheModeDoesNotAllow_WhenMergePrIsCalled_ThenItDoesNotMergeAndReturnsEveryReason", async () => {
    const t = await setup({ mode: "manual" });
    t.pr.pullRequest.labels = ["review-accepted"];
    t.pr.files = {
      items: [{ path: ".github/workflows/ci.yml", previousPath: null }],
      complete: true,
    };
    t.pr.checks = { items: passed.filter((c) => c.name !== "ci"), complete: true };
    t.host.behindDefault.add(HEAD);
    const res = await t.mergePr();
    expect(res.isError).toBe(false);
    expect(res.data.merged).toBe(false);
    expect(res.data.verdict).toBe("wait");
    expect(res.data.reasons).toEqual([
      "mode_manual",
      "gate_not_clean",
      "kept_path",
      "accepted_label",
      "behind_default_branch",
    ]);
    expect(res.data.gateReasons).toEqual(["checks_pending"]);
    expect(res.data.keptFiles).toEqual([".github/workflows/ci.yml"]);
    expect(t.host.merges).toEqual([]);
  });

  it("GivenNoModeSavedAndATicketNotInReview_WhenMergePrIsCalled_ThenItWaitsForBoth", async () => {
    const t = await setup({ mode: null });
    await t.tracker.updateTicket(
      "ai",
      t.ticket.id,
      { stage: { to: "in_progress", forced: true, reason: null } },
      "andy",
    );
    const res = await t.mergePr();
    expect(res.data.reasons).toEqual(["mode_not_set", "not_ready_for_review"]);
    expect(t.host.merges).toEqual([]);
  });

  it("GivenAPushBetweenTheQueuesVerdictAndTheMergeCall_WhenMergePrIsCalled_ThenTheOldHeadIsNotMergedAndTheNewHeadStaysQueued", async () => {
    const t = await setup();
    const merge = t.host.mergePullRequest.bind(t.host);
    t.host.mergePullRequest = async (repo, number, sha) => {
      t.pr.pullRequest.headSha = "b".repeat(40);
      return merge(repo, number, sha);
    };
    const res = await t.mergePr();
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      merged: false,
      headSha: HEAD,
      queued: true,
      queuePosition: 1,
    });
    expect(res.data.queueNote).toBe("head moved");
    expect(t.host.merges).toEqual([]);
    const events = await t.tracker.listEvents("ai", t.ticket.id);
    expect(events.find((e) => e.kind === "comment")?.body).toContain("didn't merge");
  });

  it("GivenAPrNamingATicketLinkedToAnotherPr_WhenMergePrIsCalled_ThenItWaitsAsNotReadyForReview", async () => {
    const t = await setup();
    await t.tracker.linkPullRequest(
      "ai",
      t.ticket.id,
      { number: 8, url: `https://github.com/${REPO}/pull/8`, state: "open" },
      "system",
    );
    const res = await t.mergePr();
    expect(res.data).toMatchObject({ merged: false, ticket: null });
    expect(res.data.reasons).toEqual(["not_ready_for_review"]);
    expect(t.host.merges).toEqual([]);
  });

  it("GivenTwoCleanPrsOnTheSameMain_WhenMergePrIsCalledForBothAtOnce_ThenTheFirstMergesAndTheSecondMergesOnlyAfterItsSyncAndGreenChecksFromTheWebhook", async () => {
    const t = await setup();
    const second = await t.tracker.createTicket(
      "ai",
      { title: "Second change", type: "feature" },
      "andy",
    );
    await t.tracker.updateTicket(
      "ai",
      second.id,
      { stage: { to: "ready_for_review", reason: null } },
      "andy",
    );
    const head8 = "f".repeat(40);
    const url8 = `https://github.com/${REPO}/pull/8`;
    t.host.pullRequests.set(8, {
      ...structuredClone(t.pr),
      pullRequest: {
        ...t.pr.pullRequest,
        number: 8,
        headSha: head8,
        url: url8,
        bodyFirstLine: `https://ai.andybernhagen.com/p/ai/t/${second.key}`,
      },
    });
    await t.tracker.linkPullRequest(
      "ai",
      second.id,
      { number: 8, url: url8, state: "open" },
      "system",
    );
    // The fake's checks are found by head; PR 8's are set per head here.
    const checks8 = new Map<string, HeadCheck[]>([[head8, passed]]);
    const listHeadChecks = t.host.listHeadChecks.bind(t.host);
    t.host.listHeadChecks = async (repo, sha) =>
      checks8.has(sha) ? { items: checks8.get(sha)!, complete: true } : listHeadChecks(repo, sha);
    // A merge moves main: every other open head is now behind it.
    const merge = t.host.mergePullRequest.bind(t.host);
    t.host.mergePullRequest = async (repo, number, sha) => {
      const squash = await merge(repo, number, sha);
      t.host.branches.set(`${REPO.toLowerCase()}#main`, "9".repeat(40));
      for (const p of t.host.pullRequests.values()) {
        if (p.pullRequest.state === "open") t.host.behindDefault.add(p.pullRequest.headSha);
      }
      return squash;
    };

    const [a, b] = await Promise.all([t.mergePr(), t.mergePr({ number: 8 })]);
    // Exactly one merges; which one depends on which call takes the queue's lease first.
    const [won, lost] = a.data.merged ? [a, b] : [b, a];
    expect(won.data.merged).toBe(true);
    expect(lost.data).toMatchObject({ merged: false, queued: true });
    const [first, next] = [won.data.number as number, lost.data.number as number];
    const firstHead = t.host.pullRequests.get(first)!.pullRequest.headSha;
    expect(t.host.merges.map((m) => m.number)).toEqual([first]);
    // Judged again on the new main, the other one is behind: it waits for its sync.
    expect(t.host.behindDefault.has(t.host.pullRequests.get(next)!.pullRequest.headSha)).toBe(true);

    // The re-sync workflow merges main into it: a new head, its checks running.
    const synced = "1".repeat(40);
    t.host.pullRequests.get(next)!.pullRequest.headSha = synced;
    checks8.set(synced, [
      { ...passed[0]!, status: "in_progress", conclusion: null },
      ...passed.slice(1),
    ]);
    expect((await t.checkHook(next, synced, "d-1")).status).toBe(200);
    expect(t.host.merges.map((m) => m.number)).toEqual([first]);

    checks8.set(synced, passed);
    expect((await t.checkHook(next, synced, "d-2")).status).toBe(200);
    expect(t.host.merges).toEqual([
      { fullName: REPO, number: first, sha: firstHead },
      { fullName: REPO, number: next, sha: synced },
    ]);
    const events = await t.tracker.listEvents("ai", next === 8 ? second.id : t.ticket.id);
    expect(events.some((e) => e.body?.includes(`merge_pr merged PR #${next}`))).toBe(true);
  });

  it("GivenTheDefaultBranchMovesBeforeTheMerge_WhenMergePrIsCalled_ThenItIsJudgedAgainOnTheNewTipAndWaitsForItsSync", async () => {
    const t = await setup();
    let reads = 0;
    const original = t.host.branchSha.bind(t.host);
    t.host.branchSha = async (repo, branch) => {
      if (++reads <= 2) return original(repo, branch);
      t.host.behindDefault.add(HEAD);
      return "e".repeat(40);
    };
    const res = await t.mergePr();
    expect(res.data).toMatchObject({ merged: false, queued: true, queueNote: "sync requested" });
    expect(t.host.merges).toEqual([]);
  });

  it("GivenAQueuedPrWhoseChecksFailAfterItsSync_WhenTheCheckWebhookArrives_ThenItIsDroppedAndItsTicketNeedsAndy", async () => {
    const t = await setup();
    t.host.behindDefault.add(HEAD);
    expect((await t.mergePr()).data).toMatchObject({ queued: true, merged: false });
    const synced = "2".repeat(40);
    t.pr.pullRequest.headSha = synced;
    t.pr.checks = {
      items: [{ ...passed[0]!, conclusion: "failure" }, ...passed.slice(1)],
      complete: true,
    };
    await t.checkHook(7, synced, "d-9");
    expect(t.host.merges).toEqual([]);
    const ticket = await t.tracker.getTicket("ai", t.ticket.id);
    expect(ticket?.needsAttention).toBe(true);
    const events = await t.tracker.listEvents("ai", t.ticket.id);
    expect(events.some((e) => e.body?.includes("merge queue dropped PR #7"))).toBe(true);
  });

  it("GivenAQueuedPrThatIsNoLongerCleanAfterItsSync_WhenTheCheckWebhookArrives_ThenItIsDroppedWithATicketCommentButNotFlagged", async () => {
    const t = await setup();
    t.host.behindDefault.add(HEAD);
    expect((await t.mergePr()).data).toMatchObject({ queued: true, merged: false });
    const synced = "3".repeat(40);
    t.pr.pullRequest.headSha = synced;
    t.pr.pullRequest.labels = ["review-accepted"];
    await t.checkHook(7, synced, "d-10");
    expect(t.host.merges).toEqual([]);
    expect((await t.tracker.getTicket("ai", t.ticket.id))?.needsAttention).toBe(false);
    const events = await t.tracker.listEvents("ai", t.ticket.id);
    const note = events.find((e) => e.body?.includes("merge queue dropped PR #7"));
    expect(note?.body).toContain("accepted_label");
  });

  it("GivenARepoOutsideTheProject_WhenMergePrIsCalled_ThenItIsRefused", async () => {
    const t = await setup();
    const res = await t.mergePr({ repo: "someone/else" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("not a repo of project AI");
    expect(t.host.merges).toEqual([]);
  });

  it("GivenABuildAgentsPr_WhenMergePrIsCalled_ThenItIsRefusedForTheGate", async () => {
    const t = await setup();
    t.pr.pullRequest.headRef = "agent/AI-1/run-1";
    const res = await t.mergePr();
    expect(res.isError).toBe(true);
    expect(res.text).toContain("the gate merges it");
    expect(t.host.merges).toEqual([]);
  });

  it("GivenTheHourlyCapIsUsed_WhenMergePrIsCalledAgain_ThenItIsRefused", async () => {
    const t = await setup({ mode: "manual" });
    for (let i = 0; i < MERGE_PR_HOURLY_CAP; i++) {
      expect((await t.mergePr()).isError).toBe(false);
    }
    const res = await t.mergePr();
    expect(res.isError).toBe(true);
    expect(res.text).toContain(`capped at ${MERGE_PR_HOURLY_CAP} calls per project per hour`);
  });
});

describe("merge_pr while main is red (AI-382)", () => {
  const MAIN = "c".repeat(40);

  /** Main's tip at `MAIN` with its `ci` run in `state`; signs check-run deliveries for main. */
  async function redMain(state: "failure" | "in_progress" | "success") {
    const t = await setup();
    t.host.branches.set(`${REPO.toLowerCase()}#main`, MAIN);
    const main = { ci: state };
    const listHeadChecks = t.host.listHeadChecks.bind(t.host);
    t.host.listHeadChecks = async (repo, sha) =>
      sha === MAIN
        ? {
            items: [
              {
                name: "ci",
                status: main.ci === "in_progress" ? "in_progress" : "completed",
                conclusion: main.ci === "in_progress" ? null : main.ci,
                sourceId: REVIEWER,
              },
            ],
            complete: true,
          }
        : listHeadChecks(repo, sha);
    /** A signed check_run completed delivery on main's tip: names no PR. */
    const mainCheckHook = async (id: string) => {
      const body = JSON.stringify({
        action: "completed",
        repository: { full_name: REPO },
        check_run: {
          id: 2,
          name: "ci",
          status: "completed",
          conclusion: main.ci === "success" ? "success" : "failure",
          head_sha: MAIN,
          html_url: `https://github.com/${REPO}/runs/2`,
          pull_requests: [],
        },
      });
      return t.app.request(WEBHOOK_PATH, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "check_run",
          "x-github-delivery": id,
          "x-hub-signature-256": await sign("whs", body),
        },
        body,
      });
    };
    return { ...t, main, mainCheckHook };
  }

  it("GivenARequiredCheckFailedOnMain_WhenMergePrIsCalled_ThenItWaitsWithMainRedAndIsQueuedNotMerged", async () => {
    const t = await redMain("failure");
    const res = await t.mergePr();
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      merged: false,
      verdict: "wait",
      reasons: ["main_red"],
      queued: true,
      queuePosition: 1,
      queueNote: "main_red: ci",
    });
    expect(t.host.merges).toEqual([]);
  });

  it("GivenAPrHeldForMainRed_WhenMainsCheckPassesAndItsWebhookArrives_ThenThePrMergesWithNoOneCallingAgain", async () => {
    const t = await redMain("failure");
    await t.mergePr();
    // Still red: a check finishing on main doesn't merge anything.
    expect((await t.mainCheckHook("m-1")).status).toBe(200);
    expect(t.host.merges).toEqual([]);

    t.main.ci = "success";
    expect((await t.mainCheckHook("m-2")).status).toBe(200);
    expect(t.host.merges).toEqual([{ fullName: REPO, number: 7, sha: HEAD }]);
    const events = await t.tracker.listEvents("ai", t.ticket.id);
    expect(events.some((e) => e.body?.includes("merge_pr merged PR #7"))).toBe(true);
  });

  it("GivenAPrHeldForMainRed_WhenStatusAndTheDigestAreRead_ThenBothShowTheHoldWithTheFailingCheck", async () => {
    const t = await redMain("failure");
    await t.mergePr();
    const status = await t.call("status");
    expect(status.data.mergeHolds).toEqual([
      expect.objectContaining({ project: "AI", repo: REPO, checks: ["ci"], waiting: 1 }),
    ]);
    const digest = await t.call("digest", { project: "AI" });
    expect(digest.data.exceptions).toContainEqual(
      expect.objectContaining({
        kind: "merge_held",
        reason: expect.stringContaining("failing: ci"),
      }),
    );
  });

  it("GivenMainsRequiredChecksStillRunning_WhenMergePrIsCalled_ThenItMerges", async () => {
    const t = await redMain("in_progress");
    expect((await t.mergePr()).data).toMatchObject({ merged: true, reasons: [] });
  });
});

describe("merge_pr owner rule (AI-220)", () => {
  /** Registers the tool on a stub server and returns its handler, called as `actor`. */
  function toolAs(actor: "system" | `agent:${string}`, merger: PullRequestMerger) {
    let handler: ((args: object) => Promise<{ isError?: boolean; content: unknown }>) | null = null;
    const server = {
      registerTool: (_name: string, _config: unknown, cb: typeof handler) => {
        handler = cb;
      },
    } as unknown as McpServer;
    registerMergeTools(server, { merges: merger, actor }, run);
    return handler!;
  }

  it("GivenACallerWhoIsNotTheOwner_WhenMergePrIsCalled_ThenItIsRefusedBeforeAnyRead", async () => {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: [REPO] });
    const host = new InMemoryCodeHost();
    const merger = new PullRequestMerger(tracker, host, null);
    for (const actor of ["system", "agent:run-1"] as const) {
      const res = await toolAs(actor, merger)({ project: "AI", repo: REPO, number: 7 });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("only the owner can merge a pull request");
    }
    expect(host.merges).toEqual([]);
  });

  it("GivenAQueuedMergeWhoseCallerMayNoLongerMerge_WhenTheQueueReachesIt_ThenItIsNotMergedAndTheTicketSaysWhy", async () => {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: [REPO] });
    await tracker.updateProject("ai", { mergeMode: "all-clean" });
    const created = await tracker.createTicket("ai", { title: "Queued", type: "feature" }, "andy");
    const ticket = await tracker.updateTicket(
      "ai",
      created.id,
      { stage: { to: "ready_for_review", reason: null } },
      "andy",
    );
    const host = new InMemoryCodeHost([
      { fullName: REPO, defaultBranch: "main", private: false, url: `https://github.com/${REPO}` },
    ]);
    host.requiredChecks = REQUIRED.map((name) => ({ name, sourceId: REVIEWER }));
    const url = `https://github.com/${REPO}/pull/7`;
    host.pullRequests.set(7, {
      pullRequest: {
        number: 7,
        state: "open",
        draft: false,
        title: `${ticket.key}: Queued`,
        bodyFirstLine: `https://ai.andybernhagen.com/p/ai/t/${ticket.key}`,
        fromFork: false,
        intoDefaultBranch: true,
        headRef: "m4/queued",
        headSha: HEAD,
        baseRef: "main",
        url,
        labels: [],
      },
      files: { items: [{ path: "apps/api/src/merge.ts", previousPath: null }], complete: true },
      checks: { items: passed, complete: true },
      commits: { items: [], complete: true },
    });
    await tracker.linkPullRequest("ai", ticket.id, { number: 7, url, state: "open" }, "system");
    const queue = new MergeQueue(new InMemoryMergeQueueStore(), host);
    new PullRequestMerger(tracker, host, null, () => new Date(), queue);

    // An entry stored for a caller who can't merge now: the merge-time check refuses it.
    const result = await queue.offer(REPO, {
      projectId: "ai",
      number: 7,
      kind: "merge_pr",
      actor: "agent:run-1",
      headSha: HEAD,
    });

    expect(result).toMatchObject({ result: "dropped" });
    expect((result as { reason: string }).reason).toContain("the merge was refused");
    expect(host.merges).toEqual([]);
    const events = await tracker.listEvents("ai", ticket.id);
    expect(events.some((e) => e.body?.includes("may no longer merge"))).toBe(true);
    expect((await queue.state(REPO)).entries).toEqual([]);
  });
});
