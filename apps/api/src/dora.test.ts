import {
  InMemoryDeploymentStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type NewDeployment,
} from "@andy/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ownerOnlyAccess } from "./project-access";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const deployment = (days: number, over: Partial<NewDeployment> = {}): NewDeployment => ({
  projectId: "ai",
  environment: "prod",
  imageDigest: `sha256:${"a".repeat(64)}`,
  gitSha: "b".repeat(40),
  kind: "deploy",
  status: "succeeded",
  startedAt: ago(days),
  finishedAt: ago(days),
  actor: "system",
  ...over,
});

describe("DORA API (AI-200)", () => {
  let tracker: InMemoryWorkTracker;
  let deployments: InMemoryDeploymentStore;

  const appWith = (store: InMemoryDeploymentStore | undefined) =>
    createApp({
      projectAccess: ownerOnlyAccess(),
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs: new InMemoryRunStore(),
      deployments: store,
    });

  const get = async (
    path: string,
    token = "andy",
    store: InMemoryDeploymentStore | undefined = deployments,
  ) => {
    const res = await appWith(store).request(path, {
      headers: { authorization: `Bearer ${token}` },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    deployments = new InMemoryDeploymentStore();
    await tracker.createProject({ name: "AI", key: "AI" });
  });

  it("GivenProdDeploymentsAndARollback_WhenRead_ThenBothWindowsHaveTheFourMetrics", async () => {
    const bad = await deployments.record(deployment(5));
    await deployments.record(deployment(4.5, { kind: "rollback", previousDeploymentId: bad.id }));
    await deployments.record(deployment(1));
    await deployments.record(deployment(45));

    const { status, json } = await get("/api/projects/ai/dora");

    expect(status).toBe(200);
    expect(json.windows.map((w: { days: number }) => w.days)).toEqual([30, 90]);
    expect(json.windows[0].metrics).toMatchObject({
      deployments: 2,
      changeFailureRate: 0.5,
      timeToRestoreHours: { median: 12, count: 1, open: 0 },
      leadTimeHours: { count: 0 },
    });
    expect(json.windows[1].metrics.deployments).toBe(3);
    expect(json).toMatchObject({ projectKey: "AI", leadTimeMeasured: false, partial: false });
    expect(json.latestGood.gitSha).toBe("b".repeat(40));
  });

  it("GivenNoDeploymentStore_WhenRead_ThenAnEmptyReport", async () => {
    const { status, json } = await get("/api/projects/ai/dora", "andy", undefined);

    expect(status).toBe(200);
    expect(json.windows[0].metrics.deployments).toBe(0);
    expect(json.latestGood).toBeNull();
  });

  it("GivenAnUnknownProject_WhenRead_Then404", async () => {
    expect((await get("/api/projects/nope/dora")).status).toBe(404);
  });

  it("GivenNoToken_WhenRead_Then401", async () => {
    expect((await get("/api/projects/ai/dora", "bad")).status).toBe(401);
  });
});
