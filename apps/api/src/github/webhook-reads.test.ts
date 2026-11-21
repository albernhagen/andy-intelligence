import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { countReads } from "@andy/contracts/testing";
import { sign } from "@octokit/webhooks-methods";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { ownerOnlyAccess } from "../project-access";
import { WEBHOOK_PATH } from "./webhooks";

/**
 * AI-315: documents read per GitHub webhook delivery, by event type, after the project list is
 * cached (it is re-read at most once a minute per instance). Production's busiest hour had 2,648
 * deliveries, 98% of them CI check and workflow events; these must not read per delivery.
 */

const SECRET = "test-webhook-secret";
const REPO = "albernhagen/andy-intelligence";
const repository = { full_name: REPO, default_branch: "main" };

async function setup(tickets: number) {
  const raw = new InMemoryWorkTracker();
  await raw.createProject({ name: "andy-intelligence", key: "AI", repos: [REPO] });
  for (let i = 0; i < tickets; i++) {
    const t = await raw.createTicket("ai", { title: `Done ${i}`, type: "chore" }, "andy");
    await raw.updateTicket(
      "ai",
      t.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );
  }
  const story = await raw.createTicket("ai", { title: "Story", type: "chore", body: "x" }, "andy");
  await raw.updateTicket(
    "ai",
    story.id,
    { stage: { to: "in_progress", forced: true, reason: null } },
    "andy",
  );
  const connections = new InMemoryCodeHostConnectionStore();
  await connections.save({
    appId: "1",
    slug: "andy-intelligence",
    clientId: "Iv1",
    owner: "albernhagen",
    privateKey: "PEM",
    webhookSecret: SECRET,
    connectedAt: "2026-11-03T00:00:00.000Z",
  });
  const tracker = countReads(raw);
  const runs = countReads(new InMemoryRunStore());
  const events = countReads(new InMemoryCodeEventLog());
  const host = new InMemoryCodeHost([
    { fullName: REPO, defaultBranch: "main", private: false, url: `https://github.com/${REPO}` },
  ]);
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier: { verify: () => Promise.reject(new Error("unused")) },
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker: tracker.store,
    runs: runs.store,
    github: {
      publicUrl: "https://cp.example",
      connections,
      codeHostFor: () => host,
      events: events.store,
    },
  });
  let n = 0;
  const deliver = async (event: string, payload: unknown) => {
    const body = JSON.stringify(payload);
    return app.request(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": `72d3162e-cc78-11e3-81ab-${String(++n).padStart(12, "0")}`,
        "x-hub-signature-256": await sign(SECRET, body),
      },
      body,
    });
  };
  const reads = () => tracker.reads() + runs.reads() + events.reads();
  const reset = () => [tracker, runs, events].forEach((s) => s.reset());
  return { deliver, reads, reset, story };
}

const checkRun = (action: string, status: string, conclusion: string | null) => ({
  action,
  repository,
  check_run: {
    id: 7,
    html_url: `https://github.com/${REPO}/runs/7`,
    name: "check",
    status,
    conclusion,
    head_sha: "abc123",
    pull_requests: [{ number: 31 }],
  },
});
const workflowRun = (action: string, status: string, conclusion: string | null) => ({
  action,
  repository,
  workflow_run: {
    id: 8,
    event: "pull_request",
    html_url: `https://github.com/${REPO}/actions/runs/8`,
    name: "CI",
    status,
    conclusion,
    head_branch: "m1.5/github-app",
    head_sha: "abc123",
  },
});
const pullRequest = (key: string, merged = false) => ({
  action: merged ? "closed" : "opened",
  repository,
  pull_request: {
    number: 31,
    state: merged ? "closed" : "open",
    merged,
    draft: false,
    title: `${key}: Story`,
    head: { ref: `${key}-story`, sha: "abc123", repo: { full_name: REPO } },
    base: { ref: "main" },
    html_url: `https://github.com/${REPO}/pull/31`,
  },
});

const CASES: [string, string, (key: string) => unknown][] = [
  ["check_run created", "check_run", () => checkRun("created", "queued", null)],
  ["check_run completed", "check_run", () => checkRun("completed", "completed", "success")],
  ["workflow_run requested", "workflow_run", () => workflowRun("requested", "queued", null)],
  [
    "workflow_run in_progress",
    "workflow_run",
    () => workflowRun("in_progress", "in_progress", null),
  ],
  [
    "workflow_run completed",
    "workflow_run",
    () => workflowRun("completed", "completed", "success"),
  ],
  ["pull_request opened (moves its ticket)", "pull_request", (key) => pullRequest(key)],
  [
    "pull_request merged (ticket to Done, dispatch)",
    "pull_request",
    (key) => pullRequest(key, true),
  ],
];

describe("webhook reads per delivery (AI-315)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GivenEachEventType_WhenDelivered_ThenItsReadsStayFlatAsTheProjectGrows", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rows: string[] = [];
    for (const [name, event, payload] of CASES) {
      const counts: number[] = [];
      for (const size of [10, 300]) {
        const s = await setup(size);
        // Warm the project list cache, as a busy instance has it.
        await s.deliver("check_run", checkRun("created", "queued", null));
        s.reset();
        const res = await s.deliver(event, payload(s.story.key));
        expect(res.status, name).toBe(200);
        counts.push(s.reads());
      }
      rows.push(`| ${name} | ${counts[0]} | ${counts[1]} |`);
      expect(counts[1], name).toBe(counts[0]);
    }
    if (process.env.READS_REPORT === "1") {
      process.stdout.write(
        `\n| Delivery | Reads (10 tickets) | Reads (300 tickets) |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
      );
    }
  });

  it("GivenCiCheckAndWorkflowEvents_WhenDelivered_ThenTheyReadNothingOnceTheProjectsAreCached", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const s = await setup(50);
    await s.deliver("check_run", checkRun("created", "queued", null));
    for (const [name, event, payload] of CASES.slice(0, 5)) {
      s.reset();
      await s.deliver(event, payload(s.story.key));
      expect(s.reads(), name).toBe(0);
    }
  });
});
