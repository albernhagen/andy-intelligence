import { InMemoryWatchdogQueue } from "@andy/contracts";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_URL, REPO, createdApp, githubApp } from "./github/test-app";
import { invokerTokenVerifier } from "./watchdog";

const INVOKER = "tasks-invoker@p.iam.gserviceaccount.com";
const START = new Date("2026-11-04T12:00:00.000Z");
const AFTER_DEADLINE = new Date("2026-11-04T12:46:00.000Z");

describe("invokerTokenVerifier", () => {
  async function keys() {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    const verify = invokerTokenVerifier(PUBLIC_URL, INVOKER, createLocalJWKSet({ keys: [jwk] }));
    const sign = (claims: JWTPayload, issuer = "https://accounts.google.com", aud = PUBLIC_URL) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(issuer)
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
    return { verify, sign };
  }
  const invoker = { email: INVOKER, email_verified: true };

  it("GivenAGoogleTokenForTheInvoker_WhenVerified_ThenAccepted", async () => {
    const { verify, sign } = await keys();
    await expect(verify(await sign(invoker))).resolves.toBeUndefined();
  });

  it("GivenAnotherServiceAccount_WhenVerified_ThenRejected", async () => {
    const { verify, sign } = await keys();
    await expect(
      verify(await sign({ ...invoker, email: "x@p.iam.gserviceaccount.com" })),
    ).rejects.toThrow();
    await expect(verify(await sign({ ...invoker, email_verified: false }))).rejects.toThrow();
  });

  it("GivenTheWrongAudienceOrIssuer_WhenVerified_ThenRejected", async () => {
    const { verify, sign } = await keys();
    await expect(verify(await sign(invoker, undefined, "https://x.run.app"))).rejects.toThrow();
    await expect(
      verify(await sign(invoker, "https://token.actions.githubusercontent.com")),
    ).rejects.toThrow();
  });
});

describe("run watchdog endpoint", () => {
  let now: Date;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    now = START;
  });

  async function setup() {
    const queue = new InMemoryWatchdogQueue();
    const t = githubApp(
      { now: () => now },
      {
        watchdog: {
          queue,
          publicUrl: PUBLIC_URL,
          invokerEmail: INVOKER,
          // Stand-in for Google verification: only the literal "invoker" passes.
          verifyInvokerToken: async (jwt) => {
            if (jwt !== "invoker") throw new Error("bad token");
          },
        },
      },
    );
    await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
    const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
    const ticket = await t.tracker.createTicket(project.id, { type: "story", title: "B" }, "andy");
    const res = await t.call(`/api/projects/${project.id}/tickets/${ticket.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ step: "refine" }),
    });
    const run = (await res.json()) as { id: string };
    const check = (token: string | null = "invoker", id = run.id) =>
      t.call(`/runs/${id}/watchdog`, { method: "POST" }, token);
    return { ...t, queue, run, check };
  }

  it("GivenARunIsStarted_WhenDispatched_ThenItsCheckIsQueued", async () => {
    const { queue, run } = await setup();
    expect(queue.checks.get(run.id)).toEqual({ runId: run.id, at: "2026-11-04T12:45:00.000Z" });
  });

  it("GivenNoOrAWrongToken_WhenCalled_Then401AndTheRunIsUntouched", async () => {
    const { check, runs, run } = await setup();
    now = AFTER_DEADLINE;
    expect((await check(null)).status).toBe(401);
    expect((await check("andy")).status).toBe(401);
    expect((await runs.get(run.id))?.status).toBe("queued");
  });

  it("GivenAKilledWorkflowAtTheDeadline_WhenTheCheckArrives_ThenRetriedAndAReplayIsANoOp", async () => {
    const { check, host, runs, run } = await setup();
    const wf = host.workflowRuns.get("1")!;
    wf.run = { ...wf.run, status: "completed", conclusion: "cancelled" };
    now = AFTER_DEADLINE;
    const res = await check();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "retried" });
    expect((await runs.get(run.id))?.status).toBe("cancelled");
    expect(await (await check()).json()).toEqual({ outcome: "settled" });
    expect(host.workflowRuns.size).toBe(2);
  });

  it("GivenACheckBeforeTheDeadline_WhenItArrives_Then503SoTheQueueRetriesLater", async () => {
    const { check } = await setup();
    expect((await check()).status).toBe(503);
  });

  it("GivenAMalformedRunId_WhenCalled_Then404", async () => {
    const { check } = await setup();
    expect((await check("invoker", "a.b")).status).toBe(404);
  });
});
