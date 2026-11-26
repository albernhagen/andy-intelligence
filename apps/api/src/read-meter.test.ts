import * as contracts from "@andy/contracts";
import {
  InMemoryCodeEventLog,
  InMemoryCodeHostConnectionStore,
  InMemoryOAuthGrantStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { parseAllowList } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";
import { measureReads, meterReads } from "./read-meter";
import { METERED_READS } from "./services";

const PUBLIC_URL = "https://control-plane.example.run.app";

/** The in-memory fake behind each metered store, by its port's name. */
const FAKES: Record<keyof typeof METERED_READS, string> = {
  tracker: "InMemoryWorkTracker",
  runs: "InMemoryRunStore",
  runners: "InMemoryRunnerStore",
  configChanges: "InMemoryConfigChangeStore",
  reviewFindings: "InMemoryReviewFindingSource",
  releaseNotes: "InMemoryReleaseNoteStore",
  milestones: "InMemoryMilestoneStore",
  quota: "InMemoryQuotaStore",
  nightLaunches: "InMemoryNightLaunchStore",
  deployments: "InMemoryDeploymentStore",
  releaseRequests: "InMemoryReleaseRequestStore",
  routing: "InMemoryRoutingConfigStore",
  spendLedger: "InMemorySpendLedger",
  spendCapsStore: "InMemorySpendCapsStore",
  projectLogos: "InMemoryProjectLogoStore",
  spendNotices: "InMemorySpendNoticeLedger",
  projectVersions: "InMemoryProjectVersions",
  mergeQueues: "InMemoryMergeQueueStore",
};

/** Method names that read, by convention; each must be in its store's list. */
const READ_NAME = /^(get|list|count|find|latest|recent|totals)/;

function methodsOf(className: string): string[] {
  const Fake = (contracts as unknown as Record<string, { prototype: object } | undefined>)[
    className
  ];
  if (!Fake) throw new Error(`no fake ${className}`);
  return Object.getOwnPropertyNames(Fake.prototype).filter((m) => m !== "constructor");
}

function logs(): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  vi.spyOn(console, "log").mockImplementation((l: unknown) => {
    try {
      lines.push(JSON.parse(String(l)) as Record<string, unknown>);
    } catch {
      // not a JSON log line
    }
  });
  return lines;
}

describe("read meter (AI-315)", () => {
  afterEach(() => vi.restoreAllMocks());

  for (const [key, reads] of Object.entries(METERED_READS)) {
    const className = FAKES[key as keyof typeof METERED_READS];
    it(`GivenTheMetered${key}Store_WhenItsReadListIsCheckedAgainstItsMethods_ThenEveryReadIsListedAndEveryListedNameIsAMethod`, () => {
      const methods = methodsOf(className);
      for (const r of reads) expect(methods, `${key}.${r}`).toContain(r);
      const unlisted = methods.filter((m) => READ_NAME.test(m) && !reads.includes(m as never));
      expect(unlisted, `${key}: reads missing from METERED_READS`).toEqual([]);
    });
  }

  it("GivenAMeteredTracker_WhenItReadsAndWrites_ThenOnlyTheListedReadsCountByDocuments", async () => {
    const tracker = meterReads(new InMemoryWorkTracker(), METERED_READS.tracker);
    const { reads } = await measureReads(async () => {
      await tracker.createProject({ name: "A", key: "AI", repos: [] });
      await tracker.createTicket("ai", { title: "One", type: "chore" }, "andy");
      await tracker.createTicket("ai", { title: "Two", type: "chore" }, "andy");
      await tracker.listTickets("ai");
      await tracker.getTicketByKey("ai", "AI-404");
    });
    expect(reads).toBe(3);
  });

  async function mcpApp() {
    const grants = new InMemoryOAuthGrantStore();
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "A", key: "AI", repos: [] });
    const app = createApp({
      projectAccess: ownerOnlyAccess(),
      verifier: { verify: () => Promise.reject(new Error("unused")) },
      allowedEmails: parseAllowList("andy@example.com"),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs: new contracts.InMemoryRunStore(),
      github: {
        publicUrl: PUBLIC_URL,
        connections: new InMemoryCodeHostConnectionStore(),
        events: new InMemoryCodeEventLog(),
      },
      mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    });
    return { app, grants };
  }

  it("GivenASignedInMcpCall_WhenTheToolReads_ThenTheRequestLineNamesTheTool", async () => {
    const { app, grants } = await mcpApp();
    const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
    const lines = logs();
    await call("status");
    const line = lines.find((l) => l.message === "request reads" && l.route === "/mcp");
    expect(line).toMatchObject({ tool: "status", status: 200 });
  });

  it("GivenAnUnauthenticatedMcpPost_WhenItArrives_ThenTheMeterLogsNothingAndItIsRefused", async () => {
    const { app } = await mcpApp();
    const lines = logs();
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "tools/call", params: { name: "status" } }),
    });
    expect(res.status).toBe(401);
    expect(lines.filter((l) => l.component === "read-meter")).toEqual([]);
  });
});
