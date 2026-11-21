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

/**
 * AI-279: the app's build dispatcher has the night launch store and the morning steps
 * (ADR-0049 "Night budget", AI-121, AI-124, AI-125). Built through `createApp`, so a missing
 * argument in `services.ts` fails here: before the fix the dispatcher ignored every launch.
 */

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "uid-1", email: "andy@example.com", emailVerified: true };
  },
};
const REPO = "albernhagen/andy-intelligence";
const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function setup() {
  const tracker = new InMemoryWorkTracker();
  const runs = new InMemoryRunStore();
  const nights = new InMemoryNightLaunchStore();
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
    webhookSecret: "secret",
    connectedAt: "2026-11-03T00:00:00.000Z",
  });
  await tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  await tracker.updateProject("ai", { buildEnabled: true });
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
    nightLaunches: nights,
    github: {
      publicUrl: "https://cp.example",
      connections,
      events: new InMemoryCodeEventLog(),
      codeHostFor: () => host,
    },
  });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const launch = (budget: { maxRuns: number; maxTokens: number; maxUsd: number }) =>
    call("POST", `/api/projects/ai/tickets/${epic.id}/night`, { budget, stopAt: inHours(4) });
  /** A settings change wakes dispatch for the project, as Andy's switches do. */
  const dispatch = () => call("PATCH", "/api/projects/ai", { autoBuild: true });
  return { tracker, runs, nights, epic, ready, launch, dispatch };
}

describe("night launches in the app's build dispatcher (AI-279)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenEveryStoryOfALaunchIsDone_WhenDispatchRuns_ThenTheLaunchEndsDoneAndTheMorningReportIsPosted", async () => {
    const { tracker, nights, epic, ready, launch, dispatch } = await setup();
    const story = await ready("Only story");
    expect((await launch({ maxRuns: 10, maxTokens: 1_000_000, maxUsd: 20 })).status).toBe(200);
    await tracker.updateTicket(
      "ai",
      story.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );

    expect((await dispatch()).status).toBe(200);

    const [ended] = await nights.listForProject("ai");
    expect(ended).toMatchObject({ status: "ended", endReason: "done" });
    const comments = (await tracker.listEvents("ai", epic.id)).filter((e) => e.kind === "comment");
    expect(comments.some((c) => c.body?.startsWith("## Morning report"))).toBe(true);
    expect((await tracker.getTicket("ai", epic.id))!.needsAttention).toBe(true);
  });

  it("GivenALaunchAtItsMaxAgentTasks_WhenDispatchRuns_ThenItsNextStoryDoesNotStart", async () => {
    const { tracker, runs, nights, ready, launch, dispatch } = await setup();
    const first = await ready("First");
    const second = await ready("Second");
    await launch({ maxRuns: 1, maxTokens: 1_000_000, maxUsd: 20 });
    // The launch's one agent task, already used (and still running).
    const used = await runs.create({
      projectId: "ai",
      ticketId: first.id,
      step: "build",
      route,
      tier: "fast",
      deadline: null,
    });
    await runs.update(used.id, { status: "running" }, ["queued"]);
    await tracker.updateTicket(
      "ai",
      first.id,
      { stage: { to: "in_progress", forced: true, reason: null } },
      "andy",
    );

    await dispatch();

    expect(await runs.listForTicket("ai", second.id)).toEqual([]);
    const [held] = await nights.listForProject("ai");
    expect(held!.status).toBe("stopping");
  });
});
