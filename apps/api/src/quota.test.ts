import { InMemoryQuotaStore, type QuotaStatus } from "@andy/contracts";
import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import type { ActionsClaims } from "./github/token";

const verify = async (jwt: string): Promise<ActionsClaims> => JSON.parse(jwt) as ActionsClaims;

const RESET_S = Math.floor(Date.now() / 1000) + 3600;
const event = (five: number, seven: number) => ({
  unifiedWindows: {
    five_hour: { utilization: five, resetsAt: RESET_S },
    seven_day: { utilization: seven, resetsAt: RESET_S },
  },
});
const report = {
  status: "succeeded",
  summary: "{}",
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  output: {
    summary: "**Ask**: a board",
    type: "feature",
    size: "S",
    sizeReason: "one screen",
    outOfScope: [],
    touches: [],
    questions: [],
  },
};

async function setup() {
  const quota = new InMemoryQuotaStore();
  const t = githubApp({ verifyActionsToken: verify }, { quota });
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });

  /** Starts a run and reports it; returns the report response. */
  const runAndReport = async (rateLimits?: unknown) => {
    const ticket = await t.tracker.createTicket(
      project.id,
      { type: "feature", title: "B" },
      "andy",
    );
    await t.tracker.updateTicket(
      project.id,
      ticket.id,
      { fields: { upNextRank: "0000000001" } },
      "andy",
    );
    const runsPath = `/api/projects/${project.id}/tickets/${ticket.id}/runs`;
    const started = await t.call(runsPath, {
      method: "POST",
      body: JSON.stringify({ step: "refine" }),
    });
    expect(started.status).toBe(201);
    const run = (await started.json()) as { id: string; executor: { externalId: string } };
    const claims: ActionsClaims = {
      repository: REPO,
      workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
      job_workflow_ref: CLAUDE_EXECUTOR_REF,
      run_id: run.executor.externalId,
    };
    const send = () =>
      t.call(
        `/runs/${run.id}/report`,
        {
          method: "POST",
          body: JSON.stringify({ ...report, ...(rateLimits === undefined ? {} : { rateLimits }) }),
        },
        JSON.stringify(claims),
      );
    const res = await send();
    return { res, send };
  };
  const read = async () => (await (await t.call("/api/quota")).json()) as QuotaStatus;
  return { ...t, quota, runAndReport, read };
}

describe("quota capture", () => {
  let logged: ReturnType<typeof vi.spyOn>;
  const discards = () =>
    logged.mock.calls.filter(([line]: unknown[]) =>
      String(line).includes("quota reading discarded"),
    );

  beforeEach(() => {
    logged = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAReportWithRateLimits_WhenQuotaIsRead_ThenBothWindowsAreFreshAtWarn", async () => {
    const { runAndReport, read } = await setup();
    const { res } = await runAndReport(event(0.75, 0.1));
    expect(res.status).toBe(200);
    const status = await read();
    expect(status.level).toBe("warn");
    expect(status.windows).toMatchObject([
      { window: "5h", freshness: "fresh", level: "warn", usedPct: 75 },
      { window: "weekly", freshness: "fresh", level: "ok", usedPct: 10 },
    ]);
  });

  it("GivenAReportWithoutTheField_WhenQuotaIsRead_ThenUnknown", async () => {
    const { runAndReport, read } = await setup();
    await runAndReport();
    const status = await read();
    expect(status.level).toBe("unknown");
    expect(status.windows.every((w) => w.freshness === "unknown" && w.usedPct === null)).toBe(true);
    expect(discards()).toHaveLength(0);
  });

  it("GivenAReadingPastItsReset_WhenQuotaIsRead_ThenStaleAndShownAsUnknown", async () => {
    const { quota, read } = await setup();
    await quota.save([
      {
        provider: "claude-sub",
        window: "5h",
        usedPct: 5,
        resetsAt: "2020-01-01T00:00:00.000Z",
        source: "test",
        takenAt: "2019-12-31T23:00:00.000Z",
        confidence: "high",
      },
    ]);
    const status = await read();
    expect(status.level).toBe("unknown");
    expect(status.windows[0]).toMatchObject({
      freshness: "stale",
      level: "unknown",
      usedPct: null,
    });
  });

  it("GivenAMalformedPayload_WhenReported_ThenTheRunIsRecordedTheLastReadingKeptAndOneLogLine", async () => {
    const { runAndReport, read } = await setup();
    await runAndReport(event(0.2, 0.3));
    const before = await read();
    const { res } = await runAndReport({ unifiedWindows: { five_hour: "secret-junk" } });
    expect(res.status).toBe(200);
    expect(await read()).toEqual(before);
    expect(discards()).toHaveLength(1);
    expect(String(discards()[0]?.[0])).not.toContain("secret-junk");
  });

  it("GivenAReplayedReport_WhenItArrives_ThenTheStoredReadingIsNotTouched", async () => {
    const { runAndReport, quota } = await setup();
    const { send } = await runAndReport(event(0.2, 0.3));
    const save = vi.spyOn(quota, "save");
    expect((await send()).status).toBe(200);
    expect(save).not.toHaveBeenCalled();
  });

  it("GivenTheStoreFails_WhenReported_ThenTheRunReportStillSucceedsAndItIsLogged", async () => {
    const { runAndReport, quota } = await setup();
    vi.spyOn(quota, "save").mockRejectedValue(new Error("down"));
    const { res } = await runAndReport(event(0.2, 0.3));
    expect(res.status).toBe(200);
    expect(
      logged.mock.calls.some(([l]: unknown[]) => String(l).includes("quota reading not saved")),
    ).toBe(true);
  });

  it("GivenNoSignIn_WhenQuotaIsRead_Then401", async () => {
    const { call } = await setup();
    expect((await call("/api/quota", {}, null)).status).toBe(401);
  });
});
