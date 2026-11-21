import {
  InMemoryOAuthGrantStore,
  InMemoryReleaseNoteStore,
  type PullRequest,
  type WhatsNew,
} from "@andy/contracts";
import { sign } from "@octokit/webhooks-methods";
import { beforeEach, describe, expect, it } from "vitest";
import { REPO, githubApp } from "./github/test-app";
import { WEBHOOK_PATH } from "./github/webhooks";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";

/** AI-159: a signed merge delivery stores a release note; REST and MCP read it back. */

const SECRET = "whs";
const PR_URL = `https://github.com/${REPO}/pull/31`;
const BODY = [
  "https://ai.andybernhagen.com/p/ai/t/AI-1",
  "",
  "What changed: Andy can read what merged on one page.",
  "How it works: The webhook stores the note; a route reads it.",
  "Needs you: Make the check required.",
].join("\n");

const mergedPayload = (number = 31, headRef = "AI-1/whats-new") => ({
  action: "closed",
  repository: { full_name: REPO, default_branch: "main" },
  pull_request: {
    number,
    state: "closed",
    merged: true,
    draft: false,
    title: "AI-1: What's new",
    body: BODY,
    head: { ref: headRef, sha: "abc123", repo: { full_name: REPO } },
    base: { ref: "main" },
    html_url: `https://github.com/${REPO}/pull/${number}`,
  },
});

describe("What's new (AI-159)", () => {
  let t: ReturnType<typeof githubApp>;
  let notes: InMemoryReleaseNoteStore;
  let grants: InMemoryOAuthGrantStore;

  beforeEach(async () => {
    notes = new InMemoryReleaseNoteStore();
    grants = new InMemoryOAuthGrantStore();
    t = githubApp(
      {},
      {
        releaseNotes: notes,
        mcp: { publicUrl: "https://cp.example", grants, clients: new ClientMetadataResolver() },
      },
    );
    await t.connections.save({
      appId: "1",
      slug: "andy-intelligence",
      clientId: "Iv1",
      owner: "albernhagen",
      privateKey: "PEM",
      webhookSecret: SECRET,
      connectedAt: "2026-11-03T00:00:00.000Z",
    });
    const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
    await t.tracker.createTicket(project.id, { type: "feature", title: "What's new" }, "andy");
    const pr = { number: 31, state: "merged", url: PR_URL } as PullRequest;
    t.host.pullRequests.set(31, {
      pullRequest: pr,
      files: {
        items: [{ path: "docs/features/whats-new.md", previousPath: null }],
        complete: true,
      },
      checks: { items: [], complete: true },
      commits: { items: [], complete: true },
      details: { body: BODY, mergedBy: "albernhagen", mergedAt: new Date().toISOString() },
    });
  });

  async function deliver(payload: unknown, id: string) {
    const body = JSON.stringify(payload);
    return t.app.request(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": id,
        "x-hub-signature-256": await sign(SECRET, body),
      },
      body,
    });
  }

  it("GivenASignedMergeDelivery_WhenReadOverApiAndMcp_ThenTheNoteIsListedWithItsLinks", async () => {
    expect((await deliver(mergedPayload(), "d-1")).status).toBe(200);

    const res = await t.call("/api/projects/ai/whats-new");
    expect(res.status).toBe(200);
    const w = (await res.json()) as WhatsNew;
    expect(w.notes).toHaveLength(1);
    expect(w.notes[0]).toMatchObject({
      prNumber: 31,
      ticketKey: "AI-1",
      source: "note",
      whatChanged: "Andy can read what merged on one page.",
      needsYou: "Make the check required.",
      mergedBy: "albernhagen",
    });
    expect(w.notes[0]?.links.map((l) => l.kind)).toEqual(["feature"]);

    const mcp = await mcpCaller(t.app, grants, "https://cp.example/mcp");
    const result = await mcp("whats_new", { project: "ai" });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Andy can read what merged on one page. · AI-1 · PR #31");
    expect(result.data.notes).toEqual(w.notes);
  });

  it("GivenAMergedPrUnknownToTheHost_WhenDelivered_ThenListedByTitleAsNoNote", async () => {
    expect((await deliver(mergedPayload(32, "chore/x"), "d-2")).status).toBe(200);
    expect(await notes.get("ai", "pr-32")).toMatchObject({
      source: "no_note",
      prTitle: "AI-1: What's new",
      // The description's first line still names the ticket.
      ticketKey: "AI-1",
    });
  });

  it("GivenAnEpicFilterOrBadWindow_WhenRead_ThenFilteredOr400Or404", async () => {
    await deliver(mergedPayload(), "d-3");
    const filtered = (await (
      await t.call("/api/projects/ai/whats-new?epic=AI-99")
    ).json()) as WhatsNew;
    expect(filtered.notes).toEqual([]);
    expect((await t.call("/api/projects/ai/whats-new?since=yesterday")).status).toBe(400);
    expect((await t.call("/api/projects/ai/whats-new?epic=ai-1")).status).toBe(400);
    expect((await t.call("/api/projects/zz/whats-new")).status).toBe(404);
  });
});
