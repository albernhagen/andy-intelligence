import {
  InMemoryConfigChangeStore,
  InMemoryReviewFindingSource,
  InMemoryRunStore,
  InMemoryWorkTracker,
  ReviewFinding,
  type ConfigChange,
  type ConfigProposalSweep,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";

/** ADR-0097 (AI-100): sweep → pending ConfigChange → list → Andy rejects; nothing applied. */

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "uid-1", email: "andy@example.com", emailVerified: true };
  },
};

const finding = (pullNumber: number): ReviewFinding =>
  ReviewFinding.parse({
    projectId: "ai",
    repo: "albernhagen/andy-intelligence",
    pullNumber,
    reviewer: "adversarial",
    severity: "should-fix",
    kind: "missing-test",
    title: "No test for the error path",
    file: null,
    headSha: "abc1234",
    recordedAt: `2026-11-12T10:0${pullNumber}:00.000Z`,
  });

async function setup(options: { store?: boolean; findings?: boolean } = {}) {
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ name: "AI", key: "AI" });
  const changes = new InMemoryConfigChangeStore();
  const findings = new InMemoryReviewFindingSource();
  const app = createApp({
    verifier,
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    ...(options.store === false ? {} : { configChanges: changes }),
    ...(options.findings === false ? {} : { reviewFindings: findings }),
  });
  const call = async (method: string, path: string) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
    });
    const text = await res.text();
    return {
      status: res.status,
      json: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as unknown,
    };
  };
  return { call, changes, findings };
}

describe("config proposals API", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAKindOnThreePulls_WhenSweptTwiceAndListed_ThenOnePendingChange", async () => {
    const { call, findings } = await setup();
    findings.add(finding(1), finding(2), finding(3));

    const first = await call("POST", "/api/projects/ai/config-proposals/sweep");
    const second = await call("POST", "/api/projects/ai/config-proposals/sweep");
    const listed = await call("GET", "/api/config-changes?projectId=ai");

    expect(first.status).toBe(200);
    expect((first.json as ConfigProposalSweep).created).toHaveLength(1);
    expect((second.json as ConfigProposalSweep).created).toEqual([]);
    expect(listed.json as ConfigChange[]).toMatchObject([
      { status: "pending", entityId: "AGENTS.md", projectId: "ai", appliedAt: null },
    ]);
  });

  it("GivenAPendingChange_WhenAndyRejectsIt_ThenRejectedAsHisActorAndNoLongerPending", async () => {
    const { call, findings } = await setup();
    findings.add(finding(1), finding(2), finding(3));
    const sweep = (await call("POST", "/api/projects/ai/config-proposals/sweep"))
      .json as ConfigProposalSweep;

    const rejected = await call("POST", `/api/config-changes/${sweep.created[0]}/reject`);
    const again = await call("POST", `/api/config-changes/${sweep.created[0]}/reject`);

    expect(rejected.status).toBe(200);
    expect(rejected.json).toMatchObject({ status: "rejected", decidedBy: "user:uid-1" });
    expect(again.status).toBe(409);
    expect((await call("GET", "/api/config-changes")).json).toEqual([]);
    expect((await call("GET", "/api/config-changes?status=rejected")).json).toHaveLength(1);
  });

  it("GivenNoFindingSource_WhenSwept_ThenNothingIsProposed", async () => {
    const { call } = await setup({ findings: false });
    const { status, json } = await call("POST", "/api/projects/ai/config-proposals/sweep");
    expect(status).toBe(200);
    expect(json).toMatchObject({ findingsRead: 0, created: [] });
  });

  it("GivenAnUnknownProjectOrChange_WhenCalled_Then422", async () => {
    const { call } = await setup();
    expect((await call("POST", "/api/projects/zz/config-proposals/sweep")).status).toBe(422);
    expect((await call("POST", "/api/config-changes/nope/reject")).status).toBe(422);
  });

  it("GivenNoConfigChangeStore_WhenListed_ThenTheRouteIsAbsent", async () => {
    const { call } = await setup({ store: false });
    expect((await call("GET", "/api/config-changes")).status).toBe(404);
  });
});
