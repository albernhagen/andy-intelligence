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
import { sign } from "@octokit/webhooks-methods";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { WEBHOOK_PATH } from "./github/webhooks";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { hashToken, newToken } from "./mcp/tokens";
import { ownerOnlyAccess } from "./project-access";

/**
 * AI-388 (ADR-0157): Merge from the web app. Andy's click goes through the repo's merge queue with
 * his approval, which waives what the merge mode keeps for him and nothing else; the same PR over
 * MCP `merge_pr` still waits; the approval holds across the queue's sync, not a new change.
 */

const PUBLIC_URL = "https://control-plane.example.run.app";
const REPO = "albernhagen/andy-intelligence";
const REQUIRED = ["ci", "adversarial-review", "security-review"];
const REVIEWER = "15368";
const HEAD = "a".repeat(40);
const SYNCED = "1".repeat(40);
const KEPT = { items: [{ path: ".github/workflows/ci.yml", previousPath: null }], complete: true };

const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "andy") return { uid: "andy", email: "andy@example.com", emailVerified: true };
    if (token === "other") return { uid: "eve", email: "eve@example.com", emailVerified: true };
    throw new Error("bad token");
  },
};

const passed: HeadCheck[] = REQUIRED.map((name) => ({
  name,
  status: "completed",
  conclusion: "success",
  sourceId: REVIEWER,
}));

async function setup(opts: { mode?: MergeMode; headRef?: string } = {}) {
  vi.spyOn(console, "log").mockImplementation(() => {});
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
  await tracker.updateProject("ai", { mergeMode: opts.mode ?? "manual" });
  const ticket = await tracker.createTicket(
    "ai",
    { title: "Kept change", type: "feature" },
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
    title: `${ticket.key}: Kept change`,
    bodyFirstLine: `https://ai.andybernhagen.com/p/ai/t/${ticket.key}`,
    fromFork: false,
    intoDefaultBranch: true,
    headRef: opts.headRef ?? "m5/kept-change",
    headSha: HEAD,
    baseRef: "main",
    url: `https://github.com/${REPO}/pull/7`,
    labels: [],
  };
  host.requiredChecks = REQUIRED.map((name) => ({ name, sourceId: REVIEWER }));
  host.pullRequests.set(7, {
    pullRequest,
    files: structuredClone(KEPT),
    checks: { items: passed, complete: true },
    commits: { items: [], complete: true },
  });
  await tracker.linkPullRequest(
    "ai",
    ticket.id,
    { number: 7, url: pullRequest.url, state: "open" },
    "system",
  );
  const pr = host.pullRequests.get(7)!;
  // The fake finds checks by head: a synced head's checks are set here.
  const checks = new Map<string, HeadCheck[]>([[HEAD, passed]]);
  host.listHeadChecks = async (_repo, sha) => ({ items: checks.get(sha) ?? [], complete: true });
  const click = (token = "andy", body: unknown = { repo: REPO, number: 7 }) =>
    app.request("/api/projects/ai/merges", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const checkHook = async (sha: string, id: string) => {
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
        pull_requests: [{ number: 7 }],
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
  /** GitHub merged main into the PR: a new head that contains main, its checks as given. */
  const synced = (headChecks: HeadCheck[] = passed) => {
    host.behindDefault.delete(HEAD);
    pr.pullRequest.headSha = SYNCED;
    checks.set(SYNCED, headChecks);
  };
  const comments = async () =>
    (await tracker.listEvents("ai", ticket.id))
      .filter((e) => e.kind === "comment")
      .map((e) => e.body ?? "");
  return { app, tracker, host, ticket, pr, grants, click, checkHook, synced, comments };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
const body = async (res: Response) => (await res.json()) as any;

describe("POST /api/projects/{projectId}/merges (AI-388)", () => {
  it("GivenACleanKeptPathPrInManualMode_WhenAndyClicksMerge_ThenItMergesAndTheTicketRecordsHisApproval", async () => {
    const t = await setup();
    const res = await t.click();
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({
      merged: true,
      verdict: "merge",
      reasons: [],
      keptFiles: [".github/workflows/ci.yml"],
    });
    expect(t.host.merges).toEqual([{ fullName: REPO, number: 7, sha: HEAD }]);
    expect((await t.comments()).join("\n")).toContain("Andy's Merge in the web app (ADR-0157)");
  });

  it("GivenTheSameKeptPathPr_WhenMergePrIsCalledOverMcp_ThenItStillWaitsForAndy", async () => {
    const t = await setup();
    const call = await mcpCaller(t.app, t.grants, `${PUBLIC_URL}/mcp`);
    const res = await call("merge_pr", { project: "AI", repo: REPO, number: 7 });
    expect(res.data).toMatchObject({ merged: false, reasons: ["mode_manual", "kept_path"] });
    expect(t.host.merges).toEqual([]);
  });

  it("GivenACallerWhoIsNotAllowListed_WhenPostingMerge_Then403AndNothingIsRead", async () => {
    const t = await setup();
    const read = vi.spyOn(t.host, "getPullRequest");
    expect((await t.click("other")).status).toBe(403);
    expect((await t.click("nobody")).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(t.host.merges).toEqual([]);
  });

  it("GivenAnMcpAccessToken_WhenPostingMerge_Then401SoNoSessionCarriesAndysApproval", async () => {
    const t = await setup();
    const token = newToken();
    await t.grants.put(hashToken(token), {
      kind: "access",
      clientId: "https://claude.ai/oauth/mcp-client-metadata",
      email: "andy@example.com",
      uid: "andy",
      resource: `${PUBLIC_URL}/mcp`,
      scope: "",
      redirectUri: null,
      codeChallenge: null,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    expect((await t.click(token)).status).toBe(401);
    expect(t.host.merges).toEqual([]);
  });

  it("GivenAPrWhoseChecksFailed_WhenAndyClicksMerge_ThenNothingMergesAndEveryOtherReasonIsReturned", async () => {
    const t = await setup();
    t.pr.checks = { items: passed.filter((c) => c.name !== "ci"), complete: true };
    t.host.listHeadChecks = async () => t.pr.checks;
    const res = await body(await t.click());
    expect(res).toMatchObject({ merged: false, queued: false, verdict: "wait" });
    expect(res.reasons).toEqual(["gate_not_clean"]);
    expect(res.gateReasons).toEqual(["checks_pending"]);
    expect(t.host.merges).toEqual([]);
  });

  it("GivenABehindPr_WhenAndyClicksMerge_ThenTheQueueSyncsItAndMergesTheSyncedHeadAfterGreenChecks", async () => {
    const t = await setup();
    t.host.behindDefault.add(HEAD);
    const res = await body(await t.click());
    expect(res).toMatchObject({ merged: false, queued: true, queuePosition: 1 });
    expect(res.queueNote).toBe("sync requested");
    expect(t.host.branchUpdates).toEqual([{ fullName: REPO, number: 7, sha: HEAD }]);

    t.synced([{ ...passed[0]!, status: "in_progress", conclusion: null }, ...passed.slice(1)]);
    expect((await t.checkHook(SYNCED, "d-1")).status).toBe(200);
    expect(t.host.merges).toEqual([]);

    t.synced();
    expect((await t.checkHook(SYNCED, "d-2")).status).toBe(200);
    expect(t.host.merges).toEqual([{ fullName: REPO, number: 7, sha: SYNCED }]);
  });

  it("GivenAQueuedApprovedPr_WhenANewChangeIsPushedAndItsChecksPass_ThenItIsNotMergedAndTheTicketSaysClickAgain", async () => {
    const t = await setup();
    t.host.behindDefault.add(HEAD);
    await t.click();
    // A push after Andy's click: same checks, but the PR's own diff changed.
    t.pr.files = {
      items: [...KEPT.items, { path: "infra/control-plane/iam.tf", previousPath: null }],
      complete: true,
    };
    t.synced();
    await t.checkHook(SYNCED, "d-1");
    expect(t.host.merges).toEqual([]);
    expect((await t.comments()).join("\n")).toMatch(/owner_approval_stale.*Click Merge again/s);
  });

  it("GivenABehindPrThatConflictsWithMain_WhenAndyClicksMerge_ThenDroppedAndItsTicketNeedsAndy", async () => {
    const t = await setup();
    t.host.behindDefault.add(HEAD);
    t.host.conflicting.add(7);
    const res = await body(await t.click());
    expect(res.queueNote).toContain("conflicts with the default branch");
    expect(t.host.merges).toEqual([]);
    expect((await t.tracker.getTicket("ai", t.ticket.id))?.needsAttention).toBe(true);
  });

  it("GivenABuildAgentsPrTheGateLeftForAndy_WhenHeClicksMerge_ThenItMerges", async () => {
    const t = await setup({ headRef: "agent/ai-1-kept-change" });
    expect(await body(await t.click())).toMatchObject({ merged: true });
    expect(t.host.merges).toEqual([{ fullName: REPO, number: 7, sha: HEAD }]);
  });

  it("GivenADiffTheHostCannotShowInFull_WhenAndyClicksMerge_Then422AndNothingIsQueued", async () => {
    const t = await setup();
    t.pr.diffDigest = null;
    const res = await t.click();
    expect(res.status).toBe(422);
    expect((await body(res)).error).toBeDefined();
    expect(t.host.merges).toEqual([]);
  });
});
