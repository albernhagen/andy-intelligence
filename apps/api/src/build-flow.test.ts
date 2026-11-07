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
});
