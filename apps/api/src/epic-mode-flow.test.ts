import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import { sign } from "@octokit/webhooks-methods";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import { type ActionsClaims } from "./github/token";
import { WEBHOOK_PATH } from "./github/webhooks";

/**
 * AI-216: the `epic` merge mode end to end in-process: the real API, domain, dispatcher and
 * webhook, with only GitHub faked. Two child tickets of one epic build on `epic/<KEY>`; each clean
 * PR merges there and its ticket goes Done; after the last, exactly one PR epic → main opens and
 * isn't merged; a ticket with no epic builds on main and its PR waits for Andy.
 */

const verify = async (jwt: string): Promise<ActionsClaims> => {
  if (!jwt.startsWith("{")) throw new Error("bad signature");
  return JSON.parse(jwt) as ActionsClaims;
};

const REQUIRED = ["check", "adversarial-review", "security-review"];
const passed = REQUIRED.map((name) => ({
  name,
  status: "completed" as const,
  conclusion: "success" as const,
  sourceId: "15368",
}));

describe("epic merge mode flow (AI-216)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  async function setup() {
    const t = githubApp({ verifyActionsToken: verify });
    await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
    t.host.requiredChecks = REQUIRED.map((name) => ({ name, sourceId: "15368" }));
    const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
    const send = (path: string, method: string, body: unknown) =>
      t.call(path, { method, body: JSON.stringify(body) });
    const project = await json<{ id: string }>(
      send("/api/projects", "POST", { name: "AI", key: "AI", repos: [REPO] }),
    );
    const projectPath = `/api/projects/${project.id}`;
    await send(projectPath, "PATCH", { autoRefine: false, buildEnabled: true });
    await send(projectPath, "PATCH", { mergeMode: "epic" });
    const epic = await json<{ id: string; key: string }>(
      send(`${projectPath}/tickets`, "POST", { type: "epic", title: "Epic work" }),
    );
    let delivery = 0;
    let prNumber = 60;

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

    /** A ticket built through the API to an open, green PR into its run's base branch. */
    async function created(title: string, parentId: string | null) {
      return json<{ id: string; key: string }>(
        send(`${projectPath}/tickets`, "POST", {
          type: "feature",
          title,
          body: "Andy can't see it.",
          acceptanceCriteria: ["WHEN Andy looks THE SYSTEM SHALL show it"],
          size: "S",
          sizeReason: "small",
          parentId,
        }),
      );
    }

    async function built(
      title: string,
      parentId: string | null,
      existing?: { id: string; key: string },
    ) {
      const ticket = existing ?? (await created(title, parentId));
      const ticketPath = `${projectPath}/tickets/${ticket.id}`;
      await send(`${ticketPath}/stage`, "POST", { to: "ready" });
      const run = await json<{ id: string; baseBranch: string | null }>(
        send(`${ticketPath}/runs`, "POST", { step: "build" }),
      );
      const claims: ActionsClaims = {
        repository: REPO,
        workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
        job_workflow_ref: CLAUDE_EXECUTOR_REF,
        run_id: [...t.host.workflowRuns.keys()].at(-1)!,
      };
      const asExecutor = (path: string, init: RequestInit = {}) =>
        t.call(path, init, JSON.stringify(claims));
      const context = await json<{ branch: string }>(asExecutor(`/runs/${run.id}/context`));
      const number = ++prNumber;
      const url = `https://github.com/${REPO}/pull/${number}`;
      await asExecutor(`/runs/${run.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          status: "succeeded",
          summary: "done",
          tokensIn: 1000,
          tokensOut: 100,
          costUsd: 0.1,
          usage: {
            inputTokens: 1000,
            outputTokens: 100,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            turns: 1,
            wallMs: 1000,
          },
          output: {
            summary: "done",
            plan: {
              files: ["apps/web/src/a.tsx"],
              steps: ["Write it"],
              tests: ["GivenX_WhenY_ThenZ"],
              riskiestStep: "None",
              rejectedAlternatives: ["None"],
            },
            deviations: [],
            verification: [{ command: "pnpm test", passed: true, output: "12 passed" }],
            failingTestFiles: [],
          },
          branch: context.branch,
          pullRequest: url,
        }),
      });
      const base = run.baseBranch ?? "main";
      const headSha = `head${number}`;
      t.host.pullRequests.set(number, {
        pullRequest: {
          number,
          state: "open",
          draft: false,
          title: `${ticket.key}: ${title}`,
          bodyFirstLine: `https://ai.andybernhagen.com/p/ai/t/${ticket.key}`,
          fromFork: false,
          intoDefaultBranch: base === "main",
          headRef: context.branch,
          headSha,
          baseRef: base,
          url,
          labels: [],
        },
        files: { items: [{ path: "apps/web/src/a.tsx", previousPath: null }], complete: true },
        checks: { items: passed, complete: true },
        commits: {
          items: [{ sha: headSha, author: "andy-intelligence-control[bot]" }],
          complete: true,
        },
      });
      const opened = await deliver("pull_request", {
        action: "opened",
        repository: { full_name: REPO, default_branch: "main" },
        pull_request: {
          number,
          state: "open",
          merged: false,
          draft: false,
          title: `${ticket.key}: ${title}`,
          head: { ref: context.branch, sha: headSha, repo: { full_name: REPO } },
          base: { ref: base },
          html_url: url,
          body: `https://ai.andybernhagen.com/p/ai/t/${ticket.key}\n\nDone.`,
        },
      });
      expect(opened.status).toBe(200);
      const stage = async () => (await json<{ stage: string }>(t.call(ticketPath))).stage;
      return { ticket, run, number, url, stage };
    }

    return { t, epic, built, created };
  }

  it("GivenEpicModeAndTwoChildTickets_WhenEachCleanPrArrives_ThenEachMergesIntoTheEpicBranchAndOneEpicPrOpensUnmerged", async () => {
    const { t, epic, built, created } = await setup();
    const branch = `epic/${epic.key}`;
    const ticketB = await created("B", epic.id);

    const a = await built("A", epic.id);
    expect(a.run.baseBranch).toBe(branch);
    // The epic branch was made from main's tip for the first child ticket's build.
    expect(t.host.branches.get(`${REPO.toLowerCase()}#${branch}`)).toMatch(/^[0-9a-f]{40}$/);
    expect(await a.stage()).toBe("done");
    expect(t.host.epicPullRequests).toEqual([]);

    const b = await built("B", epic.id, ticketB);
    expect(b.run.baseBranch).toBe(branch);
    expect(await b.stage()).toBe("done");

    expect(t.host.merges.map((m) => m.number)).toEqual([a.number, b.number]);
    expect(t.host.epicPullRequests).toHaveLength(1);
    const [epicPr] = t.host.epicPullRequests;
    expect(epicPr).toMatchObject({ head: branch, base: "main" });
    expect(epicPr!.body).toContain(`| ${a.ticket.key} | ${a.url} |`);
    expect(epicPr!.body).toContain(`| ${b.ticket.key} | ${b.url} |`);
    // The epic PR itself is never merged by the control plane.
    expect(t.host.merges.some((m) => m.number === epicPr!.number)).toBe(false);
  });

  it("GivenEpicModeAndATicketWithNoEpic_WhenItsCleanPrArrives_ThenItBuildsOnMainAndWaitsForAndy", async () => {
    const { t, built } = await setup();

    const lone = await built("Lone", null);

    expect(lone.run.baseBranch).toBeNull();
    expect(t.host.merges).toEqual([]);
    expect(await lone.stage()).toBe("ready_for_review");
    expect(t.host.epicPullRequests).toEqual([]);
  });
});
