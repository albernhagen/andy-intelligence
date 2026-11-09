import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import { sign } from "@octokit/webhooks-methods";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import { TOKEN_PATH, type ActionsClaims } from "./github/token";
import { WEBHOOK_PATH } from "./github/webhooks";

/**
 * M1.8a: Build run, end to end in-process (ADR-0063): the real API, domain, dispatcher and
 * webhook, with only GitHub faked. Andy turns auto-build on and moves a ticket to Ready; the
 * build starts on its own; the executor fetches its context, claims its push token, reports the
 * PR; the PR webhook moves the ticket on.
 */

/** Stand-in for Actions OIDC verification: the bearer is the JSON of its claims. */
const verify = async (jwt: string): Promise<ActionsClaims> => {
  if (!jwt.startsWith("{")) throw new Error("bad signature");
  return JSON.parse(jwt) as ActionsClaims;
};

const output = {
  summary: "Adds the board.",
  plan: {
    files: ["apps/web/src/pages/BoardPage.tsx"],
    steps: ["Write the page", "Test it"],
    tests: ["GivenTickets_WhenTheBoardOpens_ThenTheyShow"],
    riskiestStep: "Ordering by rank",
    rejectedAlternatives: ["A table: the board is the design"],
  },
  deviations: [],
  verification: [{ command: "pnpm test", passed: true, output: "12 passed" }],
  failingTestFiles: [],
};

interface RunBody {
  id: string;
  step: string;
  status: string;
  tier: string | null;
  route: { model: string };
  branch: string | null;
  plan: unknown;
  links: { pullRequest?: string };
  toolingFiles: string[];
  costUsd: number | null;
  costIsEstimate: boolean;
  planDecision: unknown;
}

describe("build run flow", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAutoBuildOn_WhenAReadyTicketIsBuilt_ThenThePrOpensAndTheTicketMovesFromInProgressToReview", async () => {
    const t = githubApp({ verifyActionsToken: verify });
    await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
    const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
    const send = (path: string, method: string, body: unknown) =>
      t.call(path, { method, body: JSON.stringify(body) });

    // Andy: a project with builds enabled (after the sandbox proof) and auto-build on.
    const project = await json<{ id: string }>(
      send("/api/projects", "POST", { name: "AI", key: "AI", repos: [REPO] }),
    );
    const projectPath = `/api/projects/${project.id}`;
    expect((await send(projectPath, "PATCH", { autoRefine: false })).status).toBe(200);
    // No build before builds are enabled: auto-build is refused, and so is any start.
    expect((await send(projectPath, "PATCH", { autoBuild: true })).status).toBe(422);
    const enabled = await json<{
      buildEnabled: boolean;
      buildEnabledBy: string;
      buildEnabledAt: string;
    }>(send(projectPath, "PATCH", { buildEnabled: true }));
    expect(enabled).toMatchObject({ buildEnabled: true, buildEnabledBy: "andy@example.com" });
    const settings = await json<{ autoRefine: boolean; autoBuild: boolean }>(
      send(projectPath, "PATCH", { autoBuild: true }),
    );
    expect(settings).toMatchObject({ autoRefine: false, autoBuild: true });
    // A client can't write who enabled builds.
    expect((await send(projectPath, "PATCH", { buildEnabledBy: "someone" })).status).toBe(400);

    // Andy: a ticket that meets the Definition of Ready, moved to Ready.
    const ticket = await json<{ id: string; key: string }>(
      send(`/api/projects/${project.id}/tickets`, "POST", {
        type: "feature",
        title: "Board",
        body: "Andy can't see his tickets.",
        acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
        size: "M",
        sizeReason: "one screen and its API",
      }),
    );
    const ticketPath = `/api/projects/${project.id}/tickets/${ticket.id}`;
    expect((await send(`${ticketPath}/stage`, "POST", { to: "ready" })).status).toBe(200);

    // The dispatcher started the build on its own, on Opus (size M), and the ticket is In progress.
    const [run] = await json<RunBody[]>(t.call(`${ticketPath}/runs`));
    expect(run).toMatchObject({
      step: "build",
      status: "queued",
      tier: "strong",
      route: { model: "opus" },
    });
    expect((await json<{ stage: string }>(t.call(ticketPath))).stage).toBe("in_progress");
    const dispatched = [...t.host.workflowRuns.values()][0]!;
    expect(dispatched.inputs).toEqual({ run_id: run!.id, credential: "subscription" });

    // The executor's jobs, as the workflow run that was dispatched.
    const claims: ActionsClaims = {
      repository: REPO,
      workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
      job_workflow_ref: CLAUDE_EXECUTOR_REF,
      run_id: [...t.host.workflowRuns.keys()][0]!,
    };
    const asExecutor = (path: string, init: RequestInit = {}) =>
      t.call(path, init, JSON.stringify(claims));

    const context = await json<{
      step: string;
      branch: string;
      ticket: { key: string };
      prompt: string;
    }>(asExecutor(`/runs/${run!.id}/context`));
    expect(context).toMatchObject({ step: "build", ticket: { key: ticket.key } });
    expect(context.branch).toBe(`agent/${ticket.key}/${run!.id}`);
    expect(context.prompt).toContain("Board");

    // publish: one repo token for this run, never a second.
    const tokenBody = { method: "POST", body: JSON.stringify({ runId: run!.id }) };
    const token = await asExecutor(TOKEN_PATH, tokenBody);
    expect(token.status).toBe(200);
    expect((await asExecutor(TOKEN_PATH, tokenBody)).status).toBe(403);

    // report: the PR the publish job opened.
    const prUrl = `https://github.com/${REPO}/pull/40`;
    const report = await asExecutor(`/runs/${run!.id}/report`, {
      method: "POST",
      body: JSON.stringify({
        status: "succeeded",
        summary: "done",
        tokensIn: 50_000,
        tokensOut: 8_000,
        costUsd: 1.25,
        output,
        branch: context.branch,
        pullRequest: prUrl,
        toolingFiles: ["package.json"],
      }),
    });
    expect(await report.json()).toEqual({ result: "recorded" });
    const [done] = await json<RunBody[]>(t.call(`${ticketPath}/runs`));
    expect(done).toMatchObject({
      status: "succeeded",
      branch: context.branch,
      plan: output.plan,
      links: { pullRequest: prUrl },
      toolingFiles: ["package.json"],
      costUsd: 1.25,
      costIsEstimate: true,
    });

    // GitHub: the PR opened on the run's branch moves the ticket to Ready for review (AI-14).
    const payload = JSON.stringify({
      action: "opened",
      repository: { full_name: REPO, default_branch: "main" },
      pull_request: {
        number: 40,
        state: "open",
        merged: false,
        draft: false,
        title: `${ticket.key}: Board`,
        head: { ref: context.branch, sha: "abc123", repo: { full_name: REPO } },
        base: { ref: "main" },
        html_url: prUrl,
        body: `https://ai.andybernhagen.com/p/ai/t/${ticket.key}\n\n## Summary`,
      },
    });
    const hook = await t.app.request(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": "11111111-2222-3333-4444-555555555555",
        "x-hub-signature-256": await sign(createdApp.webhookSecret, payload),
      },
      body: payload,
    });
    expect(hook.status).toBe(200);
    expect((await json<{ stage: string }>(t.call(ticketPath))).stage).toBe("ready_for_review");
  });

  it("GivenPlanApprovalAll_WhenAndyRejectsThenApprovesAPlan_ThenTheBuildFollowsTheApprovedPlanToAPr", async () => {
    const t = githubApp({ verifyActionsToken: verify });
    await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
    const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
    const send = (path: string, method: string, body: unknown) =>
      t.call(path, { method, body: JSON.stringify(body) });
    const claimsOf = (externalId: string): ActionsClaims => ({
      repository: REPO,
      workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
      job_workflow_ref: CLAUDE_EXECUTOR_REF,
      run_id: externalId,
    });
    /** The executor run dispatched last, acting as itself. */
    const lastExecutor = () => {
      const externalId = [...t.host.workflowRuns.keys()].at(-1)!;
      return (path: string, init: RequestInit = {}) =>
        t.call(path, init, JSON.stringify(claimsOf(externalId)));
    };
    const reportPlan = async (runId: string, summary: string) => {
      const asExecutor = lastExecutor();
      const context = await json<{ step: string; prompt: string }>(
        asExecutor(`/runs/${runId}/context`),
      );
      const res = await asExecutor(`/runs/${runId}/report`, {
        method: "POST",
        body: JSON.stringify({
          status: "succeeded",
          summary: "planned",
          tokensIn: 9_000,
          tokensOut: 1_000,
          costUsd: 0.2,
          output: { summary, plan: output.plan },
        }),
      });
      expect(await res.json()).toEqual({ result: "recorded" });
      return context;
    };

    // Andy: builds on, auto-build on, and every ticket's plan needs his approval.
    const project = await json<{ id: string }>(
      send("/api/projects", "POST", { name: "AI", key: "AI", repos: [REPO] }),
    );
    const projectPath = `/api/projects/${project.id}`;
    await send(projectPath, "PATCH", { autoRefine: false, buildEnabled: true });
    expect(
      await json<{ planApproval: string }>(
        send(projectPath, "PATCH", { autoBuild: true, planApproval: "all" }),
      ),
    ).toMatchObject({ planApproval: "all" });
    const newTicket = async (title: string) => {
      const ticket = await json<{ id: string; key: string }>(
        send(`${projectPath}/tickets`, "POST", {
          type: "feature",
          title,
          body: "Andy can't see his tickets.",
          acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
          size: "S",
          sizeReason: "one screen",
        }),
      );
      return { ...ticket, path: `${projectPath}/tickets/${ticket.id}` };
    };
    const board = await newTicket("Board");
    expect((await send(`${board.path}/stage`, "POST", { to: "ready" })).status).toBe(200);

    // The dispatcher starts a read-only plan run, not the build; the ticket stays Ready.
    const [plan] = await json<RunBody[]>(t.call(`${board.path}/runs`));
    expect(plan).toMatchObject({ step: "plan", status: "queued" });
    const planContext = await reportPlan(plan!.id, "First approach.");
    expect(planContext).toMatchObject({ step: "plan" });
    expect(planContext.prompt).toContain("You are the plan step");

    // Recorded: the plan is on the run, the ticket is flagged, nothing else started.
    const [planned] = await json<RunBody[]>(t.call(`${board.path}/runs`));
    expect(planned).toMatchObject({ status: "succeeded", plan: output.plan, planDecision: null });
    expect(
      await json<{ stage: string; needsAttention: boolean }>(t.call(board.path)),
    ).toMatchObject({ stage: "ready", needsAttention: true });
    expect(t.host.workflowRuns.size).toBe(1);

    // While the plan waits, the dispatcher skips the ticket even unflagged: the next one plans.
    expect((await send(board.path, "PATCH", { needsAttention: false })).status).toBe(200);
    const other = await newTicket("Other");
    expect((await send(`${other.path}/stage`, "POST", { to: "ready" })).status).toBe(200);
    expect(await json<RunBody[]>(t.call(`${board.path}/runs`))).toHaveLength(1);
    const [otherPlan] = await json<RunBody[]>(t.call(`${other.path}/runs`));
    expect(otherPlan).toMatchObject({ step: "plan" });
    expect((await send(`${other.path}/cancel`, "POST", {})).status).toBe(200);

    // Andy rejects with a reason: recorded, still flagged, no build.
    const decision = (runId: string) => `${board.path}/runs/${runId}/plan-decision`;
    expect((await send(decision(plan!.id), "POST", { decision: "rejected" })).status).toBe(409);
    const rejected = await json<{ run: RunBody; build: unknown }>(
      send(decision(plan!.id), "POST", { decision: "rejected", reason: "Reuse the list view." }),
    );
    expect(rejected).toMatchObject({
      build: null,
      run: {
        planDecision: {
          decision: "rejected",
          reason: "Reuse the list view.",
          by: "andy@example.com",
        },
      },
    });
    expect(await json<{ needsAttention: boolean }>(t.call(board.path))).toMatchObject({
      needsAttention: true,
    });

    // Andy starts it again: a new plan run, which sees his reason.
    const replan = await json<RunBody>(send(`${board.path}/runs`, "POST", { step: "build" }));
    expect(replan.step).toBe("plan");
    const replanContext = await reportPlan(replan.id, "Reuses the list view.");
    expect(replanContext.prompt).toContain("Reuse the list view.");

    // Andy approves: the build starts with the approved plan in its prompt.
    const approved = await json<{ run: RunBody; build: RunBody & { planRunId: string } }>(
      send(decision(replan.id), "POST", { decision: "approved" }),
    );
    expect(approved.run.planDecision).toMatchObject({ decision: "approved" });
    expect(approved.build).toMatchObject({ step: "build", planRunId: replan.id });
    expect(
      await json<{ stage: string; needsAttention: boolean }>(t.call(board.path)),
    ).toMatchObject({ stage: "in_progress", needsAttention: false });
    const asBuilder = lastExecutor();
    const context = await json<{ step: string; branch: string; prompt: string }>(
      asBuilder(`/runs/${approved.build.id}/context`),
    );
    expect(context.step).toBe("build");
    expect(context.prompt).toContain("<approved-plan>");

    // The build reports its PR, as without plan approval.
    const prUrl = `https://github.com/${REPO}/pull/41`;
    const report = await asBuilder(`/runs/${approved.build.id}/report`, {
      method: "POST",
      body: JSON.stringify({
        status: "succeeded",
        summary: "done",
        tokensIn: 50_000,
        tokensOut: 8_000,
        costUsd: 1.25,
        output,
        branch: context.branch,
        pullRequest: prUrl,
      }),
    });
    expect(await report.json()).toEqual({ result: "recorded" });
    const [built] = await json<RunBody[]>(t.call(`${board.path}/runs`));
    expect(built).toMatchObject({
      step: "build",
      status: "succeeded",
      links: { pullRequest: prUrl },
    });
  });

  describe("gate and auto-merge (AI-34)", () => {
    const REQUIRED = ["check", "adversarial-review", "security-review"];
    const passed = REQUIRED.map((name) => ({
      name,
      status: "completed" as const,
      conclusion: "success" as const,
      sourceId: "15368",
    }));
    let delivery = 0;

    /** A project on `autoMerge`, one M ticket built to an open PR #50 whose checks are green. */
    async function builtPr(
      autoMerge: string,
      opts: { files?: string[]; verificationOutput?: string } = {},
    ) {
      const t = githubApp({ verifyActionsToken: verify });
      await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
      const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
      const send = (path: string, method: string, body: unknown) =>
        t.call(path, { method, body: JSON.stringify(body) });
      const project = await json<{ id: string; autoMerge: string }>(
        send("/api/projects", "POST", { name: "AI", key: "AI", repos: [REPO] }),
      );
      expect(project.autoMerge).toBe("s-and-m");
      const projectPath = `/api/projects/${project.id}`;
      await send(projectPath, "PATCH", { autoRefine: false, buildEnabled: true });
      const patched = await json<{ autoMerge: string }>(send(projectPath, "PATCH", { autoMerge }));
      expect(patched.autoMerge).toBe(autoMerge);
      const ticket = await json<{ id: string; key: string }>(
        send(`${projectPath}/tickets`, "POST", {
          type: "feature",
          title: "Board",
          body: "Andy can't see his tickets.",
          acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
          size: "M",
          sizeReason: "one screen and its API",
        }),
      );
      const ticketPath = `${projectPath}/tickets/${ticket.id}`;
      await send(`${ticketPath}/stage`, "POST", { to: "ready" });
      const run = await json<RunBody>(send(`${ticketPath}/runs`, "POST", { step: "build" }));
      const claims: ActionsClaims = {
        repository: REPO,
        workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
        job_workflow_ref: CLAUDE_EXECUTOR_REF,
        run_id: [...t.host.workflowRuns.keys()].at(-1)!,
      };
      const asExecutor = (path: string, init: RequestInit = {}) =>
        t.call(path, init, JSON.stringify(claims));
      const context = await json<{ branch: string }>(asExecutor(`/runs/${run.id}/context`));
      const url = `https://github.com/${REPO}/pull/50`;
      const verification = [
        { command: "pnpm test", passed: true, output: opts.verificationOutput ?? "12 passed" },
      ];
      await asExecutor(`/runs/${run.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          status: "succeeded",
          summary: "done",
          tokensIn: 50_000,
          tokensOut: 8_000,
          costUsd: 1.25,
          output: { ...output, verification },
          branch: context.branch,
          pullRequest: url,
        }),
      });

      const pullRequest = {
        number: 50,
        state: "open" as const,
        draft: false,
        title: `${ticket.key}: Board`,
        bodyFirstLine: `https://ai.andybernhagen.com/p/ai/t/${ticket.key}`,
        fromFork: false,
        intoDefaultBranch: true,
        headRef: context.branch,
        headSha: "head1",
        baseRef: "main",
        url,
      };
      t.host.requiredChecks = REQUIRED.map((name) => ({ name, sourceId: "15368" }));
      t.host.pullRequests.set(50, {
        pullRequest,
        files: {
          items: (opts.files ?? ["apps/web/src/pages/BoardPage.tsx"]).map((path) => ({
            path,
            previousPath: null,
          })),
          complete: true,
        },
        checks: { items: passed, complete: true },
        commits: {
          items: [{ sha: "head1", author: "andy-intelligence-control[bot]" }],
          complete: true,
        },
      });

      const deliver = async (event: string, body: object, id = `d-${++delivery}`) => {
        const payload = JSON.stringify(body);
        return t.app.request(WEBHOOK_PATH, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": event,
            "x-github-delivery": id,
            "x-hub-signature-256": await sign(createdApp.webhookSecret, payload),
          },
          body: payload,
        });
      };
      const prHook = (action: string, state: string, merged: boolean, id?: string) =>
        deliver(
          "pull_request",
          {
            action,
            repository: { full_name: REPO, default_branch: "main" },
            pull_request: {
              number: 50,
              state,
              merged,
              draft: false,
              title: pullRequest.title,
              head: { ref: context.branch, sha: "head1", repo: { full_name: REPO } },
              base: { ref: "main" },
              html_url: url,
              body: `${pullRequest.bodyFirstLine}\n\n## Summary`,
            },
          },
          id,
        );
      const checkHook = () =>
        deliver("check_run", {
          action: "completed",
          repository: { full_name: REPO },
          check_run: {
            id: 7,
            name: "security-review",
            status: "completed",
            conclusion: "success",
            head_sha: "head1",
            html_url: "https://github.com/x/y/runs/7",
            pull_requests: [{ number: 50 }],
          },
        });
      const latestRun = async () => (await json<GateRun[]>(t.call(`${ticketPath}/runs`)))[0]!;
      const readTicket = () => json<{ stage: string; needsAttention: boolean }>(t.call(ticketPath));
      await prHook("opened", "open", false);
      return { t, prHook, checkHook, latestRun, readTicket, json, ticketPath, deliver };
    }

    interface GateRun extends RunBody {
      outcome: string | null;
      wouldAutoMerge: boolean | null;
      gateReasons: string[];
      mergeError: string | null;
      metrics: {
        ciGreenFirstTry: boolean | null;
        reviewBlockers: number | null;
        andyCommits: number | null;
        reworks: number | null;
        costEstimateUsd: number | null;
      } | null;
    }

    it("GivenPolicySAndMAndSizeM_WhenChecksPass_ThenMergedTicketDoneAndOutcomeClean", async () => {
      const f = await builtPr("s-and-m");
      expect(f.t.host.merges).toEqual([{ fullName: REPO, number: 50, sha: "head1" }]);
      expect(await f.latestRun()).toMatchObject({ wouldAutoMerge: true, gateReasons: [] });
      await f.prHook("closed", "closed", true);
      expect((await f.readTicket()).stage).toBe("done");
      expect(await f.latestRun()).toMatchObject({
        outcome: "merged_clean",
        wouldAutoMerge: true,
        metrics: {
          ciGreenFirstTry: true,
          reviewBlockers: 0,
          andyCommits: 0,
          reworks: 0,
          costEstimateUsd: 1.25,
        },
      });
    });

    it("GivenTwoFinishedChecks_WhenBothPass_ThenOnlyOneMergeIsAttempted", async () => {
      const f = await builtPr("s-and-m");
      await f.checkHook();
      await f.checkHook();
      expect(f.t.host.merges).toHaveLength(1);
    });

    it("GivenPolicyNone_WhenChecksPass_ThenItWaitsWithWouldAutoMergeRecorded", async () => {
      const f = await builtPr("none");
      await f.checkHook();
      expect(f.t.host.merges).toEqual([]);
      expect(await f.latestRun()).toMatchObject({ wouldAutoMerge: true, gateReasons: [] });
      expect((await f.readTicket()).stage).toBe("ready_for_review");
    });

    it("GivenPolicySAndSizeM_WhenChecksPass_ThenItWaits", async () => {
      const f = await builtPr("s");
      expect(f.t.host.merges).toEqual([]);
    });

    it("GivenAProtectedPath_WhenChecksPass_ThenNotMergedAndFlagged", async () => {
      const f = await builtPr("s-and-m", { files: ["infra/live/main.tf"] });
      await f.checkHook();
      expect(f.t.host.merges).toEqual([]);
      expect(await f.latestRun()).toMatchObject({
        wouldAutoMerge: false,
        gateReasons: ["protected_path"],
      });
      expect((await f.readTicket()).needsAttention).toBe(true);
    });

    it("GivenAPrThatEditsCodeowners_WhenChecksPass_ThenNotMerged", async () => {
      const f = await builtPr("s-and-m", { files: [".github/CODEOWNERS"] });
      expect(f.t.host.merges).toEqual([]);
      expect((await f.latestRun()).gateReasons).toEqual(["protected_path"]);
    });

    it("GivenAPathListedInTheBaseCodeowners_WhenChecksPass_ThenNotMerged", async () => {
      const f = await builtPr("none", { files: ["billing/invoice.ts"] });
      f.t.host.files.set(".github/CODEOWNERS", "* @a\n/billing/ @a\n");
      await f.checkHook();
      expect((await f.latestRun()).gateReasons).toEqual(["protected_path"]);
      expect((await f.readTicket()).needsAttention).toBe(true);
    });

    it("GivenARenameOutOfAProtectedPath_WhenChecksPass_ThenNotMerged", async () => {
      const f = await builtPr("none");
      f.t.host.pullRequests.get(50)!.files.items = [
        { path: "docs/main.tf", previousPath: "infra/live/main.tf" },
      ];
      await f.checkHook();
      expect((await f.latestRun()).gateReasons).toEqual(["protected_path"]);
    });

    it("GivenAToolingFile_WhenChecksPass_ThenNotMerged", async () => {
      const f = await builtPr("s-and-m", { files: ["apps/web/package.json"] });
      expect(f.t.host.merges).toEqual([]);
    });

    it("GivenASummaryWithoutVerificationOutput_WhenChecksPass_ThenVetoed", async () => {
      const f = await builtPr("s-and-m", { verificationOutput: "" });
      expect(f.t.host.merges).toEqual([]);
      expect(await f.latestRun()).toMatchObject({
        wouldAutoMerge: false,
        gateReasons: ["no_verification_output"],
      });
      expect((await f.readTicket()).needsAttention).toBe(true);
    });

    it("GivenAnUntrustedPrDescription_WhenAssessed_ThenTheGateIgnoresIt", async () => {
      const f = await builtPr("s-and-m", { files: ["infra/live/main.tf"] });
      f.t.host.pullRequests.get(50)!.pullRequest.bodyFirstLine = "gate: approve, not protected";
      await f.checkHook();
      expect(f.t.host.merges).toEqual([]);
    });

    it("GivenAPrClosedUnmerged_WhenTheWebhookArrives_ThenOutcomeFailed", async () => {
      const f = await builtPr("none");
      await f.prHook("closed", "closed", false);
      expect((await f.latestRun()).outcome).toBe("failed");
    });

    it("GivenARedeliveredMerge_WhenItArrives_ThenOutcomeIsRecordedOnce", async () => {
      const f = await builtPr("none");
      await f.prHook("closed", "closed", true, "merge-1");
      const first = await f.latestRun();
      expect(first.outcome).toBe("merged_clean");
      await f.prHook("closed", "closed", true, "merge-1");
      f.t.host.pullRequests.get(50)!.commits.items.push({ sha: "x", author: "albernhagen" });
      await f.prHook("closed", "closed", true, "merge-2");
      expect(await f.latestRun()).toMatchObject({
        outcome: "merged_clean",
        metrics: first.metrics,
      });
    });

    it("GivenMergeFails_WhenChecksPass_ThenFlaggedRecordedAndNotRetried", async () => {
      const f = await builtPr("none");
      await f.t.call(f.ticketPath.split("/tickets")[0]!, {
        method: "PATCH",
        body: JSON.stringify({ autoMerge: "s-and-m" }),
      });
      f.t.host.failMerge = new Error("merge conflict");
      await f.checkHook();
      expect(await f.latestRun()).toMatchObject({
        wouldAutoMerge: true,
        mergeError: "merge conflict",
      });
      expect((await f.readTicket()).needsAttention).toBe(true);
      f.t.host.failMerge = null;
      await f.checkHook();
      expect(f.t.host.merges).toEqual([]);
    });

    it("GivenAMergeRefusedForAMovedHead_WhenANewHeadPasses_ThenItMergesOnce", async () => {
      const f = await builtPr("none");
      await f.t.call(f.ticketPath.split("/tickets")[0]!, {
        method: "PATCH",
        body: JSON.stringify({ autoMerge: "s-and-m" }),
      });
      f.t.host.failMerge = new Error("head moved");
      await f.checkHook();
      f.t.host.failMerge = null;
      f.t.host.pullRequests.get(50)!.pullRequest.headSha = "head2";
      await f.checkHook();
      await f.checkHook();
      expect(f.t.host.merges).toEqual([{ fullName: REPO, number: 50, sha: "head2" }]);
    });

    it("GivenAndysCommitOnThePr_WhenMerged_ThenReworked", async () => {
      const f = await builtPr("none");
      f.t.host.pullRequests.get(50)!.commits.items.push({ sha: "x", author: "albernhagen" });
      await f.prHook("closed", "closed", true);
      expect(await f.latestRun()).toMatchObject({
        outcome: "reworked",
        metrics: { andyCommits: 1 },
      });
    });

    it("GivenAReviewBlockerLaterCleared_WhenMerged_ThenReworkedAndCiStillGreen", async () => {
      const f = await builtPr("none");
      const pr = f.t.host.pullRequests.get(50)!;
      pr.checks = {
        complete: true,
        items: passed.map((c) =>
          c.name === "adversarial-review" ? { ...c, conclusion: "failure" as never } : c,
        ),
      };
      await f.checkHook();
      pr.checks = { complete: true, items: passed };
      await f.prHook("closed", "closed", true);
      expect(await f.latestRun()).toMatchObject({
        outcome: "reworked",
        metrics: { reviewBlockers: 1, ciGreenFirstTry: true },
      });
    });

    it("GivenAFailedCiThenGreen_WhenMerged_ThenCiGreenFirstTryIsFalse", async () => {
      const f = await builtPr("none");
      const pr = f.t.host.pullRequests.get(50)!;
      pr.checks = {
        complete: true,
        items: passed.map((c) =>
          c.name === "check" ? { ...c, conclusion: "failure" as never } : c,
        ),
      };
      await f.checkHook();
      pr.checks = { complete: true, items: passed };
      await f.prHook("closed", "closed", true);
      expect(await f.latestRun()).toMatchObject({
        outcome: "merged_clean",
        metrics: { ciGreenFirstTry: false },
      });
    });

    it("GivenAMergedRun_WhenARevertPrMerges_ThenOutcomeReverted", async () => {
      const f = await builtPr("none");
      await f.prHook("closed", "closed", true);
      f.t.host.pullRequests.get(50)!.pullRequest.state = "merged";
      await f.deliver("pull_request", {
        action: "closed",
        repository: { full_name: REPO, default_branch: "main" },
        pull_request: {
          number: 51,
          state: "closed",
          merged: true,
          draft: false,
          title: 'Revert "AI-1: Board"',
          head: { ref: "revert-50-agent/x", sha: "r", repo: { full_name: REPO } },
          base: { ref: "main" },
          html_url: `https://github.com/${REPO}/pull/51`,
          body: `Reverts ${REPO}#50`,
        },
      });
      expect((await f.latestRun()).outcome).toBe("reverted");
    });

    it("GivenAHumanBranch_WhenChecksPass_ThenTheGateLeavesItAlone", async () => {
      const f = await builtPr("s-and-m");
      f.t.host.merges.length = 0;
      f.t.host.pullRequests.get(50)!.pullRequest.headRef = "m1.8/some-branch";
      await f.checkHook();
      expect(f.t.host.merges).toEqual([]);
    });
  });
});
