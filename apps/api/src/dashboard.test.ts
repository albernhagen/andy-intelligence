import {
  InMemoryRunStore,
  InMemoryWorkTracker,
  type Dashboard,
  type ProjectDashboard,
} from "@andy/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};
const ROUTE = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;
const USAGE = {
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 4,
  wallMs: 1,
};

describe("dashboards API (AI-102)", () => {
  let app: ReturnType<typeof createApp>;
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;

  const finish = async (
    projectId: string,
    ticketId: string,
    step: "build" | "refine",
    over: object,
  ) => {
    const r = await runs.create({ projectId, ticketId, step, route: ROUTE, tier: null });
    await runs.update(r.id, { status: "succeeded", endedAt: new Date().toISOString(), ...over }, [
      "queued",
    ]);
  };

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    runs = new InMemoryRunStore();
    app = createApp({
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs,
    });
    for (const key of ["AI", "BB"]) {
      await tracker.createProject({ name: key, key });
      const t = await tracker.createTicket(key.toLowerCase(), { title: "x", size: "M" }, "andy");
      await finish(t.projectId, t.id, "build", { costUsd: 1.5, usage: USAGE });
      await finish(t.projectId, t.id, "refine", { costUsd: 0.5, usage: USAGE });
      await finish(t.projectId, t.id, "build", { costUsd: null, usage: null });
    }
  });

  const get = async (path: string, token = "andy") => {
    const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, json: (await res.json()) as unknown };
  };

  it("GivenSeededAgentTasks_WhenTheProjectDashboardIsRead_ThenTheNumbersMatch", async () => {
    const { status, json } = await get("/api/projects/ai/dashboard");

    expect(status).toBe(200);
    const dash = json as ProjectDashboard;
    expect(dash).toMatchObject({ projectId: "ai", key: "AI", partial: [] });
    expect(dash.weeks).toHaveLength(8);
    const now = dash.weeks.at(-1)!;
    expect(now.ticketsByStage.backlog).toBe(1);
    expect(now.cost).toMatchObject({
      runs: 3,
      unknownCostRuns: 1,
      estimatedCostUsd: 2,
      tokensIn: 2000,
      tokensOut: 400,
      turns: 8,
    });
    expect(now.byStep.find((s) => s.step === "build")).toMatchObject({
      runs: 2,
      unknownCostRuns: 1,
      estimatedCostUsd: 1.5,
    });
    expect(now.bySize.find((s) => s.size === "M")).toMatchObject({ runs: 3 });
    expect(dash.expensiveRuns.map((r) => r.costUsd)).toEqual([1.5, 0.5]);
  });

  it("GivenAWeeksParameter_WhenTheDashboardIsRead_ThenThatManyWeeksAreReturned", async () => {
    const { json } = await get("/api/projects/ai/dashboard?weeks=26");

    expect((json as ProjectDashboard).weeks).toHaveLength(26);
  });

  it("GivenTooManyWeeks_WhenTheDashboardIsRead_ThenBadRequest", async () => {
    expect((await get("/api/projects/ai/dashboard?weeks=27")).status).toBe(400);
    expect((await get("/api/dashboard?weeks=0")).status).toBe(400);
  });

  it("GivenAnUnknownProject_WhenItsDashboardIsRead_ThenNotFound", async () => {
    expect((await get("/api/projects/zz/dashboard")).status).toBe(404);
  });

  it("GivenNoSignIn_WhenADashboardIsRead_ThenUnauthorized", async () => {
    expect((await get("/api/dashboard", "nobody")).status).toBe(401);
  });

  it("GivenTwoProjects_WhenTheAllProjectsDashboardIsRead_ThenTotalsAreSummedAndPerProject", async () => {
    const { status, json } = await get("/api/dashboard?weeks=2");

    expect(status).toBe(200);
    const dash = json as Dashboard;
    expect(dash.weeks).toHaveLength(2);
    expect(dash.weeks.at(-1)!.cost).toMatchObject({
      runs: 6,
      unknownCostRuns: 2,
      estimatedCostUsd: 4,
    });
    expect(dash.projects.map((p) => [p.key, p.weeks.at(-1)!.cost.estimatedCostUsd])).toEqual([
      ["AI", 2],
      ["BB", 2],
    ]);
    expect(dash.expensiveRuns).toHaveLength(4);
  });
});
