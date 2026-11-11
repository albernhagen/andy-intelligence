import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import {
  InMemoryNotifyFlushQueue,
  InMemoryNotifyLedger,
  InMemoryWatchdogQueue,
  type Ticket,
} from "@andy/contracts";
import { EMAIL_BATCH_WINDOW_MS, EMAIL_DAILY_CAP } from "@andy/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_URL, REPO, createdApp, githubApp } from "./github/test-app";
import type { ActionsClaims } from "./github/token";
import { ResendNotifier } from "./notifier-email";
import type { EmailStatus } from "./notify";
import { startFakeEmailServer, type FakeEmailServer } from "./notify-test-server";

/**
 * AI-77 end to end in-process: a refine run's question flags the ticket, the real API and domain
 * queue it, the queue's flush call sends it through the Resend adapter to a fake server.
 */

const T0 = new Date("2026-11-10T12:00:00.000Z");
const verifyActions = async (jwt: string): Promise<ActionsClaims> =>
  JSON.parse(jwt) as ActionsClaims;

const output = (question: string) => ({
  summary: "**Ask**: a board",
  type: "feature",
  size: "S",
  sizeReason: "one screen",
  risk: "low",
  riskReason: "one screen",
  confidence: "high",
  confidenceReason: "the code answers it",
  outOfScope: [],
  touches: [],
  body: "Andy can't see his tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  outcome: "ready",
  reason: null,
  children: [],
  gaps: [
    {
      question,
      assumption: `Assume ${question}`,
      context: `Context for ${question}`,
      options: [],
      recommendation: { answer: "yes", reason: "the simplest" },
      cost: "direction",
      confidence: "unsure",
      urgency: "normal",
    },
  ],
});

async function setup(server: FakeEmailServer | null) {
  let now = T0;
  const queue = new InMemoryNotifyFlushQueue();
  const t = githubApp(
    { verifyActionsToken: verifyActions },
    {
      watchdog: {
        queue: new InMemoryWatchdogQueue(),
        publicUrl: PUBLIC_URL,
        invokerEmail: "invoker@p.iam.gserviceaccount.com",
        verifyInvokerToken: async (jwt) => {
          if (jwt !== "invoker") throw new Error("not the invoker");
        },
      },
      email: server
        ? {
            notifier: new ResendNotifier({
              apiKey: "re_test",
              from: "from@x.test",
              to: "to@x.test",
              baseUrl: server.baseUrl,
            }),
            ledger: new InMemoryNotifyLedger(),
            flushQueue: queue,
            appUrl: PUBLIC_URL,
            now: () => now,
          }
        : undefined,
    },
  );
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const base = `/api/projects/${project.id}`;
  await t.call(base, { method: "PATCH", body: JSON.stringify({ dailyQuestionCap: 50 }) });

  const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
  const post = (path: string, body: unknown = {}) =>
    t.call(path, { method: "POST", body: JSON.stringify(body) });

  /** A ticket that a refine run's question flags as Needs-you. */
  async function flagged(title: string, question: string): Promise<Ticket> {
    const ticket = await json<Ticket>(post(`${base}/tickets`, { title, upNext: true }));
    const runs = await json<{ id: string; step: string; executor: { externalId: string } }[]>(
      t.call(`${base}/tickets/${ticket.id}/runs`),
    );
    const run = runs.find((r) => r.step === "refine")!;
    const claims = {
      repository: REPO,
      workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
      job_workflow_ref: CLAUDE_EXECUTOR_REF,
      run_id: run.executor.externalId,
    } satisfies ActionsClaims;
    const res = await t.call(
      `/runs/${run.id}/report`,
      {
        method: "POST",
        body: JSON.stringify({
          status: "succeeded",
          summary: "{}",
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
          output: output(question),
        }),
      },
      JSON.stringify(claims),
    );
    expect(res.status).toBe(200);
    const after = await json<Ticket>(t.call(`${base}/tickets/${ticket.id}`));
    expect(after.needsAttention).toBe(true);
    return after;
  }

  /** The queue's call at the window's end. */
  const flush = () => t.call("/notify/email/flush", { method: "POST" }, "invoker");
  const endWindow = () => (now = new Date(now.getTime() + EMAIL_BATCH_WINDOW_MS));

  return { ...t, base, json, post, flagged, flush, endWindow, queue };
}

describe("notify flow (AI-77)", () => {
  let server: FakeEmailServer;
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    server = await startFakeEmailServer();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
  });

  it("GivenARefineQuestion_WhenTheWindowEnds_ThenExactlyOneEmailWithTheQuestionKeyTitleAndLink", async () => {
    const t = await setup(server);
    const ticket = await t.flagged("Board", "Which board?");
    expect(t.queue.scheduled.size).toBe(1);
    expect((await t.flush()).status).toBe(503); // early: the queue retries
    expect(server.requests).toHaveLength(0);

    t.endWindow();
    expect(await (await t.flush()).json()).toEqual({ outcome: "sent" });
    expect(server.requests).toHaveLength(1);
    const body = server.requests[0]!.body;
    expect(body).toMatchObject({
      from: "from@x.test",
      to: ["to@x.test"],
      subject: `andy-intelligence: ${ticket.key} needs you`,
    });
    expect(body.text).toContain(`${ticket.key}: Board`);
    expect(body.text).toContain("Question: Which board?");
    expect(body.text).toContain(`${PUBLIC_URL}/p/ai/t/${ticket.key}`);

    expect(await (await t.flush()).json()).toEqual({ outcome: "none" });
    expect(server.requests).toHaveLength(1);
  });

  it("GivenThreeItemsWithinTheWindow_WhenItEnds_ThenOneEmailHoldsAllThree", async () => {
    const t = await setup(server);
    const keys = [];
    for (const n of [1, 2, 3]) keys.push((await t.flagged(`T${n}`, `Q${n}?`)).key);
    t.endWindow();
    await t.flush();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.body.subject).toBe("andy-intelligence: 3 items need you");
    for (const key of keys) expect(server.requests[0]!.body.text).toContain(key);
  });

  it("GivenTheDailyCap_WhenThe21stAnd22ndWindowsEnd_ThenOneMoreWaitingEmailThenNothing", async () => {
    const t = await setup(server);
    for (let n = 1; n <= EMAIL_DAILY_CAP + 2; n++) {
      await t.flagged(`T${n}`, `Q${n}?`);
      t.endWindow();
      await t.flush();
    }
    expect(server.requests).toHaveLength(EMAIL_DAILY_CAP + 1);
    const last = server.requests.at(-1)!.body;
    expect(last.subject).toBe("andy-intelligence: more items need you");
    expect(last.text).toContain("no more email until tomorrow");
  });

  it("GivenTheProjectTurnedEmailOff_WhenATicketIsFlagged_ThenNothingIsSent", async () => {
    const t = await setup(server);
    await t.call(t.base, { method: "PATCH", body: JSON.stringify({ emailNotifications: false }) });
    await t.flagged("Board", "Which board?");
    t.endWindow();
    await t.flush();
    expect(server.requests).toHaveLength(0);
  });

  it("GivenATokenThatIsNotTheInvokers_WhenFlushIsCalled_ThenRefused", async () => {
    const t = await setup(server);
    expect((await t.call("/notify/email/flush", { method: "POST" }, "andy")).status).toBe(401);
  });

  it("GivenEmailIsConfigured_WhenATestIsSent_ThenOneEmailAndTheCountShows", async () => {
    const t = await setup(server);
    expect((await t.post("/api/notify/email/test")).status).toBe(200);
    expect(server.requests).toHaveLength(1);
    const status = await t.json<EmailStatus>(t.call("/api/notify/email"));
    expect(status).toEqual({ configured: true, sentToday: 1, dailyCap: 20, windowMinutes: 10 });
  });

  it("GivenTheProviderRefusesTheTest_WhenSent_Then502WithTheReasonAndNothingCounted", async () => {
    const t = await setup(server);
    server.status = 403;
    const res = await t.post("/api/notify/email/test");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/^test email not sent: /);
    expect((await t.json<EmailStatus>(t.call("/api/notify/email"))).sentToday).toBe(0);
  });

  it("GivenNoKeyConfigured_WhenATicketIsFlagged_ThenNothingIsSentAndSettingsSayOff", async () => {
    const t = await setup(null);
    await t.flagged("Board", "Which board?");
    expect((await t.call("/notify/email/flush", { method: "POST" }, "invoker")).status).toBe(404);
    expect(server.requests).toHaveLength(0);
    const status = await t.json<EmailStatus>(t.call("/api/notify/email"));
    expect(status.configured).toBe(false);
    expect((await t.post("/api/notify/email/test")).status).toBe(409);
  });
});
