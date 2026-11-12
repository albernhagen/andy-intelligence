import { InMemoryConfigChangeStore, InMemoryReviewFindingSource } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionsClaims } from "./github/token";
import { REPO, createdApp, githubApp } from "./github/test-app";
import { REVIEW_FINDINGS_PATH, REVIEW_FINDINGS_RATE_LIMIT, reviewCaller } from "./review-findings";

/** AI-100 (ADR-0097 PR B): review verdicts posted with an Actions OIDC token, end to end. */

const HEAD = "a".repeat(40);
const reviewRef = (role: string, pr: number) =>
  `${REPO}/.github/workflows/${role}-review.yml@refs/pull/${pr}/merge`;

async function setup() {
  const log = new InMemoryReviewFindingSource();
  let claims: ActionsClaims = { repository: REPO, workflow_ref: reviewRef("adversarial", 7) };
  const verify = vi.fn(async (jwt: string) => {
    if (jwt !== "oidc") throw new Error("bad token");
    return claims;
  });
  const t = githubApp(
    { verifyActionsToken: verify },
    { reviewFindings: log, configChanges: new InMemoryConfigChangeStore() },
  );
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const post = (body: unknown, token: string | null = "oidc") =>
    t.call(REVIEW_FINDINGS_PATH, { method: "POST", body: JSON.stringify(body) }, token);
  const read = () => log.recent("ai", { maxPulls: 20, maxFindings: 500 });
  return { t, log, post, read, as: (c: ActionsClaims) => (claims = c) };
}

const finding = {
  severity: "should-fix",
  kind: "missing-test",
  title: "No test for the error path",
  file: "packages/domain/src/x.ts",
};

describe("POST /review/findings", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenTheAdversarialReviewOfPr7_WhenItPostsAVerdict_ThenItsFindingsAreStoredForThatPr", async () => {
    const s = await setup();
    const res = await s.post({ headSha: HEAD, findings: [finding] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ recorded: 1 });
    expect(await s.read()).toMatchObject([
      {
        projectId: "ai",
        repo: REPO,
        pullNumber: 7,
        reviewer: "adversarial",
        kind: "missing-test",
        headSha: HEAD,
      },
    ]);
  });

  it("GivenALaterCleanVerdict_WhenPosted_ThenThePrHasNoFindings", async () => {
    const s = await setup();
    await s.post({ headSha: HEAD, findings: [finding] });
    await s.post({ headSha: "b".repeat(40), findings: [] });
    expect(await s.read()).toEqual([]);
  });

  it.each([
    ["no token", null],
    ["a bad token", "forged"],
  ])("GivenACallWith%s_WhenPosted_Then401AndNothingStored", async (_name, token) => {
    const s = await setup();
    expect((await s.post({ headSha: HEAD, findings: [finding] }, token)).status).toBe(401);
    expect(await s.read()).toEqual([]);
  });

  it.each([
    [
      "the executor workflow",
      { repository: REPO, workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main` },
    ],
    [
      "a review workflow on main",
      {
        repository: REPO,
        workflow_ref: `${REPO}/.github/workflows/security-review.yml@refs/heads/main`,
      },
    ],
    [
      "another repo's review naming this repo",
      { repository: "evil/repo", workflow_ref: reviewRef("security", 7) },
    ],
    [
      "a repo in no project",
      {
        repository: "someone/else",
        workflow_ref: "someone/else/.github/workflows/security-review.yml@refs/pull/1/merge",
      },
    ],
  ])("GivenATokenFrom%s_WhenPosted_Then403AndNothingStored", async (_name, claims) => {
    const s = await setup();
    s.as(claims);
    expect((await s.post({ headSha: HEAD, findings: [finding] })).status).toBe(403);
    expect(await s.read()).toEqual([]);
  });

  it.each([
    ["a pull number in the body", { headSha: HEAD, findings: [finding], pullNumber: 1 }],
    ["a kind that is no slug", { headSha: HEAD, findings: [{ ...finding, kind: "Missing Test" }] }],
    ["a title over its cap", { headSha: HEAD, findings: [{ ...finding, title: "x".repeat(301) }] }],
    ["too many findings", { headSha: HEAD, findings: Array.from({ length: 51 }, () => finding) }],
    [
      "a security severity from the adversarial review",
      { headSha: HEAD, findings: [{ ...finding, severity: "high" }] },
    ],
  ])("GivenAVerdictWith%s_WhenPosted_Then400AndNothingStored", async (_name, body) => {
    const s = await setup();
    expect((await s.post(body)).status).toBe(400);
    expect(await s.read()).toEqual([]);
  });

  it("GivenTheRateLimitReached_WhenPostedAgain_Then429", async () => {
    const s = await setup();
    for (let i = 0; i < REVIEW_FINDINGS_RATE_LIMIT; i++)
      await s.post({ headSha: HEAD, findings: [] });
    expect((await s.post({ headSha: HEAD, findings: [] })).status).toBe(429);
  });

  it("GivenStoredFindingsOnThreePrs_WhenAndySweeps_ThenOnePendingProposalNamesTheKind", async () => {
    const s = await setup();
    for (const pr of [1, 2, 3]) {
      s.as({ repository: REPO, workflow_ref: reviewRef("adversarial", pr) });
      await s.post({ headSha: HEAD, findings: [finding] });
    }
    const res = await s.t.call("/api/projects/ai/config-proposals/sweep", { method: "POST" });
    expect(res.status).toBe(200);
    const pending = await (await s.t.call("/api/config-changes?projectId=ai")).json();
    expect(JSON.stringify(pending)).toContain("missing-test");
  });
});

describe("reviewCaller", () => {
  it("GivenAReviewRef_WhenParsed_ThenRepoPrAndRoleComeFromIt", () => {
    expect(reviewCaller({ repository: REPO, workflow_ref: reviewRef("security", 12) })).toEqual({
      repo: REPO,
      pullNumber: 12,
      reviewer: "security",
    });
  });
});
