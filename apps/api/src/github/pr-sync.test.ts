import type { Project } from "@andy/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthEnv } from "../auth";
import { PR_SYNC_PATH, PR_SYNC_RATE_LIMIT, registerPrSync, resyncWorkflowRef } from "./pr-sync";
import type { ActionsClaims } from "./token";

/** AI-388 (ADR-0157): the re-sync workflow reads its project's PR sync setting by its OIDC token. */

const REPO = "albernhagen/andy-intelligence";
const project = (over: Partial<Project> = {}) =>
  ({ id: "ai", key: "AI", enabled: true, repos: [REPO], prSync: "queue", ...over }) as Project;

const claims = (over: Partial<ActionsClaims> = {}): ActionsClaims => ({
  repository: REPO,
  workflow_ref: resyncWorkflowRef(REPO),
  ...over,
});

function setup(opts: { stored?: Project | null; cached?: Project | null; tickMs?: number } = {}) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const app = new Hono<AuthEnv>();
  let clock = Date.parse("2026-11-26T10:00:00.000Z");
  const stored = opts.stored === undefined ? project() : opts.stored;
  registerPrSync(app, {
    // Stand-in for Actions OIDC verification: the bearer is the JSON of its claims.
    verify: async (jwt) => {
      if (!jwt.startsWith("{")) throw new Error("bad signature");
      return JSON.parse(jwt) as ActionsClaims;
    },
    registeredProject: async (repo) =>
      repo === REPO ? (opts.cached === undefined ? project() : opts.cached) : null,
    getProject: async () => stored,
    now: () => new Date((clock += opts.tickMs ?? 60_000)),
  });
  const read = (token: ActionsClaims | string | null = claims()) =>
    app.request(PR_SYNC_PATH, {
      method: "POST",
      headers:
        token === null
          ? {}
          : {
              authorization: `Bearer ${typeof token === "string" ? token : JSON.stringify(token)}`,
            },
    });
  return { read };
}

describe("POST /github/pr-sync (AI-388)", () => {
  it.each(["queue", "all"] as const)(
    "GivenTheReSyncWorkflowOnMainAndASettingOf%s_WhenRead_ThenItIsReturned",
    async (prSync) => {
      const res = await setup({ stored: project({ prSync }) }).read();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ prSync });
    },
  );

  it("GivenACachedProjectAndANewerStoredSetting_WhenRead_ThenTheStoredOneCounts", async () => {
    const res = await setup({
      cached: project({ prSync: "queue" }),
      stored: project({ prSync: "all" }),
    }).read();
    expect(await res.json()).toEqual({ prSync: "all" });
  });

  it.each([
    [
      "another workflow",
      claims({ workflow_ref: `${REPO}/.github/workflows/ci.yml@refs/heads/main` }),
    ],
    [
      "the workflow on a PR ref",
      claims({ workflow_ref: `${REPO}/.github/workflows/resync-prs.yml@refs/pull/1/merge` }),
    ],
    ["another repo's workflow", claims({ workflow_ref: resyncWorkflowRef("evil/fork") })],
    [
      "an unregistered repo",
      claims({ repository: "evil/fork", workflow_ref: resyncWorkflowRef("evil/fork") }),
    ],
  ])("GivenACallerThatIs %s_WhenRead_Then403", async (_name, token) => {
    expect((await setup().read(token)).status).toBe(403);
  });

  it("GivenADisabledProject_WhenRead_Then403", async () => {
    expect((await setup({ stored: project({ enabled: false }) }).read()).status).toBe(403);
  });

  it.each([null, "not-a-token"])("GivenNoOrABadToken %s_WhenRead_Then401", async (token) => {
    expect((await setup().read(token)).status).toBe(401);
  });

  it("GivenTheRateCapIsUsed_WhenReadAgain_Then429", async () => {
    const { read } = setup({ tickMs: 0 });
    for (let i = 0; i < PR_SYNC_RATE_LIMIT; i++) expect((await read()).status).toBe(200);
    expect((await read()).status).toBe(429);
  });

  it("GivenManyAnonymousCalls_WhenTheWorkflowReads_ThenItIsNotRateLimited", async () => {
    const { read } = setup({ tickMs: 0 });
    for (let i = 0; i < PR_SYNC_RATE_LIMIT * 2; i++) expect((await read(null)).status).toBe(401);
    expect((await read()).status).toBe(200);
  });
});
