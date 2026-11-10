import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import { sign } from "@octokit/webhooks-methods";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import { TOKEN_PATH, type ActionsClaims } from "./github/token";
import { WEBHOOK_PATH } from "./github/webhooks";

/**
 * AI-72: Sync runs, end to end in-process (ADR-0083): the real API, domain, dispatchers, gate and
 * webhooks, with only GitHub faked. Two agent PRs are open; main moves (a signed `push`
 * delivery); the stale PR gets one sync run, the current one none; the run fetches its context,
 * claims its push token and reports; the gate never merges a head a sync is about to replace.
 */

const verify = async (jwt: string) => JSON.parse(jwt) as ActionsClaims;
const sha = (c: string) => c.repeat(40);

const buildOutput = {
  summary: "Adds the thing.",
  plan: {
    files: ["apps/web/src/a.ts"],
    steps: ["Write it"],
    tests: ["GivenX_WhenY_ThenZ"],
    riskiestStep: "none",
    rejectedAlternatives: [],
  },
  deviations: [],
  verification: [{ command: "pnpm test", passed: true, output: "12 passed" }],
  failingTestFiles: [],
};

const syncOutput = (outcome: "synced" | "conflict_unresolved") => ({
  outcome,
  summary: outcome === "synced" ? "Resolved a.ts." : "Both sides reorder the gate.",
  conflictFiles: ["apps/web/src/a.ts"],
  reason: outcome === "synced" ? "" : "The PR and main reorder the gate's vetoes differently.",
  verification: [{ command: "pnpm test", passed: true, output: "12 passed" }],
});

const REQUIRED = ["ci", "adversarial-review", "security-review"];
const passed = REQUIRED.map((name) => ({
  name,
  status: "completed" as const,
  conclusion: "success" as const,
  sourceId: "15368",
}));

interface RunBody {
  id: string;
  step: string;
  status: string;
  gateReasons: string[];
  wouldAutoMerge: boolean | null;
  syncRun: { number: number; outcome: string | null; pushedSha: string | null } | null;
  prSync: { pendingSince: string | null; waiting: string | null; stoppedHeadSha: string | null };
}

describe("sync run flow", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  async function world(autoMerge = "none") {
    const t = githubApp({ verifyActionsToken: verify });
    await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
    const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
    const send = (path: string, method: string, body: unknown) =>
      t.call(path, { method, body: JSON.stringify(body) });
    const project = await json<{ id: string }>(
      send("/api/projects", "POST", { name: "AI", key: "AI", repos: [REPO] }),
    );
    const projectPath = `/api/projects/${project.id}`;
    await send(projectPath, "PATCH", { autoRefine: false, buildEnabled: true, runsAtOnce: 4 });
    await send(projectPath, "PATCH", { autoMerge });
    t.host.requiredChecks = REQUIRED.map((name) => ({ name, sourceId: "15368" }));
    let delivery = 0;

    const asExecutor = (path: string, init: RequestInit = {}) => {
      const claims: ActionsClaims = {
        repository: REPO,
        workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
        job_workflow_ref: CLAUDE_EXECUTOR_REF,
        run_id: [...t.host.workflowRuns.keys()].at(-1)!,
      };
      return t.call(path, init, JSON.stringify(claims));
    };
    const deliver = async (event: string, body: object) => {
      const payload = JSON.stringify(body);
      return t.app.request(WEBHOOK_PATH, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": event,
          "x-github-delivery": `d-${++delivery}`,
          "x-hub-signature-256": await sign(createdApp.webhookSecret, payload),
        },
        body: payload,
      });
    };
    const pushMain = (after: string) =>
      deliver("push", {
        ref: "refs/heads/main",
        after,
        repository: { full_name: REPO, default_branch: "main" },
      });

    /** A size-M ticket built to open PR #`n` with head `head` and green checks. */
    async function agentPr(n: number, head: string) {
      const ticket = await json<{ id: string; key: string }>(
        send(`${projectPath}/tickets`, "POST", {
          type: "feature",
          title: `Thing ${n}`,
          body: "Andy can't do it yet.",
          acceptanceCriteria: ["WHEN Andy asks THE SYSTEM SHALL do it"],
          size: "M",
          sizeReason: "one screen",
        }),
      );
      const ticketPath = `${projectPath}/tickets/${ticket.id}`;
      await send(`${ticketPath}/stage`, "POST", { to: "ready" });
      const run = await json<RunBody>(send(`${ticketPath}/runs`, "POST", { step: "build" }));
      const context = await json<{ branch: string }>(asExecutor(`/runs/${run.id}/context`));
      const url = `https://github.com/${REPO}/pull/${n}`;
      await asExecutor(`/runs/${run.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          status: "succeeded",
          summary: "done",
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
          output: buildOutput,
          branch: context.branch,
          pullRequest: url,
        }),
      });
      t.host.pullRequests.set(n, {
        pullRequest: {
          number: n,
          state: "open",
          draft: false,
          title: `${ticket.key}: Thing ${n}`,
          bodyFirstLine: `https://ai.andybernhagen.com/p/ai/t/${ticket.key}`,
          fromFork: false,
          intoDefaultBranch: true,
          headRef: context.branch,
          headSha: head,
          baseRef: "main",
          url,
        },
        files: { items: [{ path: "apps/web/src/a.ts", previousPath: null }], complete: true },
        checks: { items: passed, complete: true },
        commits: { items: [], complete: true },
      });
      const prHook = (action: string) => {
        const pr = t.host.pullRequests.get(n)!.pullRequest;
        return deliver("pull_request", {
          action,
          repository: { full_name: REPO, default_branch: "main" },
          pull_request: {
            number: n,
            state: "open",
            merged: false,
            draft: false,
            title: pr.title,
            head: { ref: pr.headRef, sha: pr.headSha, repo: { full_name: REPO } },
            base: { ref: "main" },
            html_url: url,
            body: `${pr.bodyFirstLine}\n\n## Summary`,
          },
        });
      };
      const runs = () => json<RunBody[]>(t.call(`${ticketPath}/runs`));
      const syncs = async () => (await runs()).filter((r) => r.step === "sync");
      const build = async () => (await runs()).find((r) => r.step === "build")!;
      const read = () =>
        json<{ needsAttention: boolean; statusLine?: unknown }>(t.call(ticketPath));
      return { ticket, ticketPath, url, branch: context.branch, prHook, syncs, build, read };
    }

    const reportSync = async (runId: string, body: object) => {
      await asExecutor(`/runs/${runId}/context`);
      return json<{ result: string }>(
        asExecutor(`/runs/${runId}/report`, {
          method: "POST",
          body: JSON.stringify({
            status: "succeeded",
            summary: null,
            tokensIn: 1,
            tokensOut: 1,
            costUsd: 0,
            ...body,
          }),
        }),
      );
    };
    return { t, json, send, projectPath, asExecutor, pushMain, agentPr, reportSync };
  }

  it("GivenTwoAgentPrs_WhenMainMoves_ThenOnlyTheStaleOneSyncsAndASecondPushCoalesces", async () => {
    const w = await world();
    const stale = await w.agentPr(40, sha("a"));
    const current = await w.agentPr(41, sha("b"));
    await stale.prHook("opened");
    await current.prHook("opened");
    w.t.host.behindDefault.add(sha("a"));

    expect((await w.pushMain(sha("1"))).status).toBe(200);
    const [run, ...more] = await stale.syncs();
    expect(more).toEqual([]);
    expect(run).toMatchObject({ step: "sync", status: "queued", syncRun: { number: 40 } });
    expect(await current.syncs()).toEqual([]);

    // A second push while it is queued starts nothing new for that PR.
    expect((await w.pushMain(sha("2"))).status).toBe(200);
    expect(await stale.syncs()).toHaveLength(1);

    // The executor: its context names the PR branch and head; one push token, as for a build.
    const context = await w.json<{ step: string; branch: string; sync: object }>(
      w.asExecutor(`/runs/${run!.id}/context`),
    );
    expect(context).toMatchObject({
      step: "sync",
      branch: stale.branch,
      sync: { pullRequest: 40, headSha: sha("a") },
    });
    const grant = { method: "POST", body: JSON.stringify({ runId: run!.id }) };
    expect((await w.asExecutor(TOKEN_PATH, grant)).status).toBe(200);
    expect((await w.asExecutor(TOKEN_PATH, grant)).status).toBe(403);

    // Synced: the merge is pushed; the gate then decides on the new head as usual.
    w.t.host.pullRequests.get(40)!.pullRequest.headSha = sha("c");
    const reported = await w.reportSync(run!.id, {
      output: syncOutput("synced"),
      branch: stale.branch,
      headSha: sha("c"),
    });
    expect(reported).toEqual({ result: "recorded" });
    expect((await stale.syncs())[0]).toMatchObject({
      status: "succeeded",
      syncRun: { outcome: "synced", pushedSha: sha("c") },
    });
    await stale.prHook("synchronize");
    expect(await stale.build()).toMatchObject({ wouldAutoMerge: true, gateReasons: [] });
    expect((await stale.read()).needsAttention).toBe(false);
  });

  it("GivenAnUnresolvableConflict_WhenReported_ThenNeedsYouAndNoSyncUntilTheHeadChanges", async () => {
    const w = await world();
    const pr = await w.agentPr(40, sha("a"));
    w.t.host.behindDefault.add(sha("a"));
    await w.pushMain(sha("1"));
    const [run] = await pr.syncs();
    await w.reportSync(run!.id, { output: syncOutput("conflict_unresolved") });

    expect((await pr.read()).needsAttention).toBe(true);
    expect((await pr.build()).prSync).toMatchObject({ stoppedHeadSha: sha("a") });

    await w.pushMain(sha("2"));
    expect(await pr.syncs()).toHaveLength(1);

    // Andy merges main by hand into a head that is still behind a newer main: syncing resumes.
    w.t.host.pullRequests.get(40)!.pullRequest.headSha = sha("d");
    w.t.host.behindDefault.add(sha("d"));
    await w.pushMain(sha("3"));
    expect(await pr.syncs()).toHaveLength(2);
  });

  it("GivenAutoMergeAllAndGreenChecks_WhenASyncIsQueuedForThePr_ThenTheGateRefusesToMerge", async () => {
    const w = await world("all");
    const pr = await w.agentPr(50, sha("a"));
    w.t.host.behindDefault.add(sha("a"));
    // Builds are busy elsewhere: the sync is queued (global cap), not running.
    await w.send(w.projectPath, "PATCH", { paused: true });
    await w.pushMain(sha("1"));
    expect(await pr.syncs()).toEqual([]);
    expect((await pr.build()).prSync).toMatchObject({ waiting: "paused" });

    await pr.prHook("opened");
    expect(w.t.host.merges).toEqual([]);
    expect(await pr.build()).toMatchObject({
      wouldAutoMerge: false,
      gateReasons: ["sync_pending"],
    });

    // Unpaused, the sync starts; still no merge while it runs.
    await w.send(w.projectPath, "PATCH", { paused: false });
    const [run] = await pr.syncs();
    expect(run).toMatchObject({ status: "queued" });
    await pr.prHook("synchronize");
    expect(w.t.host.merges).toEqual([]);
  });

  it("GivenThreeSyncsInADay_WhenMainMovesAgain_ThenNoFourthStartsAndAndyIsFlagged", async () => {
    const w = await world();
    const pr = await w.agentPr(40, sha("a"));
    for (const head of ["a", "b", "c"]) {
      w.t.host.pullRequests.get(40)!.pullRequest.headSha = sha(head);
      w.t.host.behindDefault.add(sha(head));
      await w.pushMain(sha(head === "a" ? "1" : head === "b" ? "2" : "3"));
      const queued = (await pr.syncs()).find((r) => r.status === "queued")!;
      await w.reportSync(queued.id, { alreadyCurrent: true });
    }
    w.t.host.pullRequests.get(40)!.pullRequest.headSha = sha("e");
    w.t.host.behindDefault.add(sha("e"));
    await w.pushMain(sha("4"));
    expect(await pr.syncs()).toHaveLength(3);
    expect((await pr.build()).prSync).toMatchObject({ waiting: "daily_cap" });
    expect((await pr.read()).needsAttention).toBe(true);
  });

  it("GivenTheHostFailsWhileQueueing_WhenMainMoves_ThenTheWebhookFailsAndARedeliveryQueuesTheSync", async () => {
    const w = await world();
    const pr = await w.agentPr(40, sha("a"));
    w.t.host.behindDefault.add(sha("a"));
    const real = w.t.host.headContains.bind(w.t.host);
    w.t.host.headContains = async () => {
      throw new Error("GitHub 502");
    };
    const body = {
      ref: "refs/heads/main",
      after: sha("1"),
      repository: { full_name: REPO, default_branch: "main" },
    };
    const payload = JSON.stringify(body);
    const deliver = async () =>
      w.t.app.request(WEBHOOK_PATH, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-github-delivery": "redeliver-1",
          "x-hub-signature-256": await sign(createdApp.webhookSecret, payload),
        },
        body: payload,
      });
    expect((await deliver()).status).toBe(500);
    expect(await pr.syncs()).toEqual([]);

    // GitHub's redelivery (same delivery ID) is a duplicate record, but the tick runs again.
    w.t.host.headContains = real;
    const again = await deliver();
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ result: "duplicate" });
    expect(await pr.syncs()).toHaveLength(1);
  });

  it("GivenAPushToAnotherBranchOrATag_WhenDelivered_ThenNothingIsRecordedOrSynced", async () => {
    const w = await world();
    const pr = await w.agentPr(40, sha("a"));
    w.t.host.behindDefault.add(sha("a"));
    const other = await w.t.app.request(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "p-1",
        "x-hub-signature-256": await sign(
          createdApp.webhookSecret,
          JSON.stringify({
            ref: "refs/heads/agent/AI-1/x",
            after: sha("9"),
            repository: { full_name: REPO, default_branch: "main" },
          }),
        ),
      },
      body: JSON.stringify({
        ref: "refs/heads/agent/AI-1/x",
        after: sha("9"),
        repository: { full_name: REPO, default_branch: "main" },
      }),
    });
    expect(await other.json()).toEqual({ result: "ignored", reason: "branch" });
    expect(await pr.syncs()).toEqual([]);
  });
});
