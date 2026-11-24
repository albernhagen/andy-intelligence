import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type HeadCheck,
  type MergeMode,
  type PullRequest,
} from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
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

/** A host whose PR head moves during the last assessment read, before the merge call. */
class MovingHeadHost extends InMemoryCodeHost {
  moveHeadOnCheck = false;
  override async headContains(fullName: string, head: string): Promise<boolean | null> {
    const answer = await super.headContains(fullName, head);
    if (this.moveHeadOnCheck) {
      for (const pr of this.pullRequests.values()) pr.pullRequest.headSha = "b".repeat(40);
    }
    return answer;
  }
}

async function setup(opts: { mode?: MergeMode | null } = {}) {
  const tracker = new InMemoryWorkTracker();
  const grants = new InMemoryOAuthGrantStore();
  const host = new MovingHeadHost([
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
  return { tracker, host, ticket, call, mergePr, pr: host.pullRequests.get(7)! };
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

  it("GivenTheHeadMovesBetweenAssessmentAndMerge_WhenMergePrIsCalled_ThenItDoesNotMerge", async () => {
    const t = await setup();
    t.host.moveHeadOnCheck = true;
    const res = await t.mergePr();
    expect(res.isError).toBe(false);
    expect(res.data.merged).toBe(false);
    expect(res.data.headSha).toBe(HEAD);
    expect(res.data.mergeError).toContain("head moved");
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

  it("GivenTwoCleanPrsOnTheSameMain_WhenMergePrIsCalledForBothAtOnce_ThenOnlyTheFirstMergesAndTheSecondWaitsBehind", async () => {
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
    // The fake's checks are found by head; give PR 8 its own.
    const listHeadChecks = t.host.listHeadChecks.bind(t.host);
    t.host.listHeadChecks = async (repo, sha) =>
      sha === head8 ? { items: passed, complete: true } : listHeadChecks(repo, sha);
    // A merge moves main: every other open head is now behind it.
    const merge = t.host.mergePullRequest.bind(t.host);
    t.host.mergePullRequest = async (repo, number, sha) => {
      const squash = await merge(repo, number, sha);
      t.host.branches.set(`${REPO}#main`, "9".repeat(40));
      for (const p of t.host.pullRequests.values()) {
        if (p.pullRequest.state === "open") t.host.behindDefault.add(p.pullRequest.headSha);
      }
      return squash;
    };
    const [a, b] = await Promise.all([t.mergePr(), t.mergePr({ number: 8 })]);
    expect(a.data.merged).toBe(true);
    expect(b.data).toMatchObject({ merged: false, verdict: "wait" });
    expect(b.data.reasons).toEqual(["behind_default_branch"]);
    expect(t.host.merges.map((m) => m.number)).toEqual([7]);
  });

  it("GivenTheDefaultBranchMovesBeforeTheMerge_WhenMergePrIsCalled_ThenItWaitsAsBehind", async () => {
    const t = await setup();
    let reads = 0;
    const original = t.host.branchSha.bind(t.host);
    t.host.branchSha = async (repo, branch) =>
      ++reads > 1 ? "e".repeat(40) : original(repo, branch);
    const res = await t.mergePr();
    expect(res.data).toMatchObject({ merged: false, verdict: "wait" });
    expect(res.data.reasons).toEqual(["behind_default_branch"]);
    expect(t.host.merges).toEqual([]);
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
});
