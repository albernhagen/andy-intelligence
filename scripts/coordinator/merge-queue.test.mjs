import { describe, expect, it } from "vitest";
import { cleanPr, fakeGh, reviewBody } from "./fake-gh.mjs";
import { runQueue, waitForMain } from "./merge-queue.mjs";

const green = [{ name: "ci", status: "completed", conclusion: "success", url: "u" }];

/** A clock that advances by each sleep, so polling tests finish instantly. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
}

function queue(prs, numbers, opts = {}) {
  const gh = fakeGh(prs, opts);
  const lines = [];
  const promise = runQueue(numbers, {
    run: gh.run,
    patterns: [],
    log: (l) => lines.push(l),
    ...clock(),
    ...opts,
  });
  return promise.then((result) => ({ result, lines, calls: gh.calls }));
}

const merges = (calls) => calls.filter((c) => c.startsWith("gh pr merge"));

describe("merge queue", () => {
  it("GivenCleanPr_WhenQueued_ThenMergedAtSurveyedHeadAndMainWaitedFor", async () => {
    const { result, calls } = await queue({ 7: cleanPr(7) }, [7]);
    expect(result).toMatchObject({ merged: [7], stopped: null });
    expect(merges(calls)).toEqual([`gh pr merge 7 --squash --match-head-commit ${"a".repeat(40)}`]);
    expect(calls.some((c) => c.includes("run list --branch main --commit m7"))).toBe(true);
    expect(calls).toContain("gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/branch-7");
  });

  it("GivenPrBehindMain_WhenQueued_ThenRefused", async () => {
    const { result, calls } = await queue({ 7: cleanPr(7, { behindBy: 1 }) }, [7]);
    expect(result.skipped[0].reasons).toContain("head is 1 commit(s) behind main");
    expect(merges(calls)).toEqual([]);
  });

  it("GivenSyncCheckFails_WhenQueued_ThenNeverTreatedAsSynced", async () => {
    const { result, calls } = await queue({ 7: cleanPr(7, { compareError: true }) }, [7]);
    expect(result.skipped[0].reasons.join()).toMatch(/sync unknown/);
    expect(merges(calls)).toEqual([]);
  });

  it("GivenFailingCheck_WhenQueued_ThenRefused", async () => {
    const checks = [{ name: "ci", bucket: "fail" }];
    const { result, calls } = await queue({ 7: cleanPr(7, { checks }) }, [7]);
    expect(result.skipped[0].reasons).toContain("failing checks: ci");
    expect(merges(calls)).toEqual([]);
  });

  it.each(["security", "adversarial"])(
    "GivenMissing%sVerdict_WhenQueued_ThenRefused",
    async (role) => {
      const other = role === "security" ? "adversarial" : "security";
      const comments = [{ login: "github-actions[bot]", body: reviewBody(other), updated_at: "1" }];
      const { result, calls } = await queue({ 7: cleanPr(7, { comments }) }, [7]);
      expect(result.skipped[0].reasons).toContain(`no ${role} verdict`);
      expect(merges(calls)).toEqual([]);
    },
  );

  it("GivenLabel_WhenQueued_ThenRefused", async () => {
    const pr = cleanPr(7);
    pr.view.labels = [{ name: "security-accepted" }];
    const { calls } = await queue({ 7: pr }, [7]);
    expect(merges(calls)).toEqual([]);
  });

  it("GivenMainRedBeforeStart_WhenQueued_ThenStopsWithoutMerging", async () => {
    const runs = () => [{ name: "ci", status: "completed", conclusion: "failure", url: "u" }];
    const { result, calls } = await queue({ 7: cleanPr(7) }, [7], { runs });
    expect(result.stopped).toMatch(/before any merge: main is red/);
    expect(merges(calls)).toEqual([]);
  });

  it("GivenMainFailsAfterFirstMerge_WhenQueued_ThenStopsBeforeTheNext", async () => {
    const runs = (sha) =>
      sha.startsWith("m7")
        ? [{ name: "ci", status: "completed", conclusion: "failure", url: "u" }]
        : green;
    const { result, calls } = await queue({ 7: cleanPr(7), 8: cleanPr(8) }, [7, 8], { runs });
    expect(result).toMatchObject({ merged: [7], stopped: expect.stringMatching(/main is red/) });
    expect(merges(calls)).toHaveLength(1);
  });

  it("GivenMergeRefused_WhenQueued_ThenStops", async () => {
    const { result } = await queue({ 7: cleanPr(7) }, [7], { mergeFails: true });
    expect(result.stopped).toMatch(/merge of #7 failed/);
  });

  it("GivenDryRun_WhenQueued_ThenNothingMerged", async () => {
    const { lines, calls } = await queue({ 7: cleanPr(7) }, [7], { dryRun: true });
    expect(merges(calls)).toEqual([]);
    expect(lines.join("\n")).toMatch(/would merge/);
  });
});

describe("waitForMain", () => {
  it("GivenRunsInProgressThenGreen_WhenWaiting_ThenOk", async () => {
    let n = 0;
    const runs = () =>
      ++n < 3 ? [{ name: "ci", status: "in_progress", conclusion: "", url: "u" }] : green;
    const { run } = fakeGh({}, { runs });
    expect(
      await waitForMain("s".repeat(40), { run, timeoutMs: 3_600_000, ...clock() }),
    ).toMatchObject({ ok: true });
  });

  it("GivenNoRunsEverAppear_WhenWaiting_ThenFails", async () => {
    const { run } = fakeGh({}, { runs: () => [] });
    const r = await waitForMain("s".repeat(40), { run, timeoutMs: 3_600_000, ...clock() });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/no runs appeared/) });
  });

  it("GivenRunsNeverFinish_WhenWaiting_ThenTimesOut", async () => {
    const { run } = fakeGh(
      {},
      { runs: () => [{ name: "ci", status: "queued", conclusion: "", url: "u" }] },
    );
    const r = await waitForMain("s".repeat(40), { run, timeoutMs: 60_000, ...clock() });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/still running/) });
  });
});
