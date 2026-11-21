import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryNightLaunchStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ownerOnlyAccess } from "./project-access";

/** AI-125: M4.22: the morning report goes on the epic when a launch ends (ADR-0049). */

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "uid-1", email: "andy@example.com", emailVerified: true };
  },
};
const REPO = "albernhagen/andy-intelligence";
const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;
const BUDGET = { maxRuns: 10, maxTokens: 1_000_000, maxUsd: 20 };
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function setup(github: boolean) {
  const tracker = new InMemoryWorkTracker();
  const runs = new InMemoryRunStore();
  const host = new InMemoryCodeHost([
    { fullName: REPO, defaultBranch: "main", private: false, url: `https://github.com/${REPO}` },
  ]);
  const connections = new InMemoryCodeHostConnectionStore();
  if (github)
    await connections.save({
      appId: "1",
      slug: "andy-intelligence",
      clientId: "Iv1",
      owner: "albernhagen",
      privateKey: "PEM",
      webhookSecret: "secret",
      connectedAt: "2026-11-03T00:00:00.000Z",
    });
  await tracker.createProject({ name: "AI", key: "AI", repos: github ? [REPO] : [] });
  const epic = await tracker.createTicket("ai", { title: "Night", type: "epic" }, "andy");
  const ready = async (title: string) => {
    const t = await tracker.createTicket(
      "ai",
      {
        type: "feature",
        title,
        body: "A story.",
        acceptanceCriteria: ["When Andy opens it, the system shall show it."],
        size: "S",
        sizeReason: "small",
        parentId: epic.id,
      },
      "andy",
    );
    return tracker.updateTicket(
      "ai",
      t.id,
      { stage: { to: "ready", forced: true, reason: null } },
      "andy",
    );
  };
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier,
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs,
    nightLaunches: new InMemoryNightLaunchStore(),
    ...(github
      ? {
          github: {
            publicUrl: "https://cp.example",
            connections,
            events: new InMemoryCodeEventLog(),
            codeHostFor: () => host,
          },
        }
      : {}),
  });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const path = `/api/projects/ai/tickets/${epic.id}/night`;
  const reports = async () =>
    (await tracker.listEvents("ai", epic.id)).filter(
      (e) => e.kind === "comment" && e.body?.startsWith("## Morning report"),
    );
  return { tracker, runs, host, epic, ready, call, path, reports };
}

describe("morning report", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAStoryMergedOvernight_WhenTheLaunchEnds_ThenTheEpicGetsOneReportLinkingTheMorningPrAndIsFlagged", async () => {
    const { ready, call, path, host, epic, runs, tracker, reports } = await setup(true);
    const first = await ready("First");
    const second = await ready("Second");
    await call("POST", path, { budget: BUDGET, stopAt: inHours(4) });
    const branch = `epic/${epic.key}` as const;
    const run = await runs.create({
      projectId: "ai",
      ticketId: first.id,
      step: "build",
      route,
      tier: "fast",
      deadline: null,
      baseBranch: branch,
    });
    await runs.update(run.id, { status: "running" }, ["queued"]);
    const sha = "e".repeat(40);
    await runs.update(
      run.id,
      {
        status: "succeeded",
        costUsd: 1.5,
        tokensIn: 100_000,
        tokensOut: 20_000,
        links: { pullRequest: `https://github.com/${REPO}/pull/41` },
        epicMerge: { at: new Date().toISOString(), sha },
      },
      ["running"],
    );
    host.branches.set(`${REPO}#${branch}`, sha);

    expect((await call("POST", `${path}/stop`)).status).toBe(200);

    const [report] = await reports();
    expect(report!.body).toContain("Ended because Andy stopped it. Of 2 stories: 1 merged");
    expect(report!.body).toContain(`Morning PR: [#`);
    expect(report!.body).toContain(
      `| [${first.key}](https://cp.example/p/ai/t/${first.key}) | merged | [#41](https://github.com/${REPO}/pull/41) |`,
    );
    expect(report!.body).toContain(
      `[${second.key}](https://cp.example/p/ai/t/${second.key}) not started`,
    );
    expect((await tracker.getTicket("ai", epic.id))!.needsAttention).toBe(true);
    expect(host.epicPullRequests[0]!.body).toContain("The morning report");

    // Reading the status settles the (already ended) launch again: still one report.
    await call("GET", path);
    expect(await reports()).toHaveLength(1);
  });

  it("GivenNoGitHub_WhenTheLaunchEnds_ThenTheReportStillPostsWithRelativeLinks", async () => {
    const { ready, call, path, reports } = await setup(false);
    const first = await ready("First");
    await call("POST", path, { budget: BUDGET, stopAt: inHours(4) });

    await call("POST", `${path}/stop`);

    const [report] = await reports();
    expect(report!.body).toContain("Morning PR: none (no code host connected).");
    expect(report!.body).toContain(`[${first.key}](/p/ai/t/${first.key}) not started`);
  });
});
