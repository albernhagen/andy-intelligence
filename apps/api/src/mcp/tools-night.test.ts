import {
  InMemoryNightLaunchStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ClientMetadataResolver } from "./client-metadata";
import { mcpCaller } from "./test-client";

const PUBLIC_URL = "https://control-plane.example.run.app";

const verifier: TokenVerifier = {
  async verify() {
    throw new Error("MCP tests use OAuth tokens");
  },
};

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const BUDGET = { maxRuns: 10, maxTokens: 1_000_000, maxUsd: 20 };

/** M4.17: night_status, launch_night, stop_night over MCP (the same rules as REST). */
async function setup(options: { store?: boolean } = {}) {
  const tracker = new InMemoryWorkTracker();
  const grants = new InMemoryOAuthGrantStore();
  const store = new InMemoryNightLaunchStore();
  await tracker.createProject({ name: "AI", key: "AI" });
  const epic = await tracker.createTicket("ai", { title: "Night", type: "epic" }, "andy");
  const child = await tracker.createTicket(
    "ai",
    {
      type: "feature",
      title: "Story",
      body: "A story.",
      acceptanceCriteria: ["When Andy opens it, the system shall show it."],
      size: "S",
      sizeReason: "small",
      parentId: epic.id,
    },
    "andy",
  );
  const app = createApp({
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    ...(options.store === false ? {} : { nightLaunches: store }),
  });
  const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
  const ready = () =>
    tracker.updateTicket(
      "ai",
      child.id,
      { stage: { to: "ready", forced: true, reason: null } },
      "andy",
    );
  return { call, store, epic, child, ready };
}

describe("night MCP tools", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAStoryNotReady_WhenNightStatusIsRead_ThenItsProblemIsListedByKey", async () => {
    const { call, epic, child } = await setup();
    const { isError, data } = await call("night_status", { ticket: epic.key.toLowerCase() });
    expect(isError).toBe(false);
    expect(data.epicKey).toBe(epic.key);
    expect(data.problems).toEqual([
      { kind: "not_ready", ticketKey: child.key, message: `${child.key}: in Backlog, not Ready` },
    ]);
  });

  it("GivenSomethingOpen_WhenLaunchNight_ThenRefusedListingTheProblemByKey", async () => {
    const { call, store, epic, child } = await setup();
    const { isError, text } = await call("launch_night", {
      ticket: epic.key,
      ...BUDGET,
      stopAt: inHours(4),
    });
    expect(isError).toBe(true);
    expect(text).toBe(`${epic.key} can't be launched yet: ${child.key}: in Backlog, not Ready`);
    expect(await store.listForProject("ai")).toEqual([]);
  });

  it("GivenNothingOpen_WhenLaunchedThenStopped_ThenRunningThenStopping", async () => {
    const { call, epic, ready } = await setup();
    await ready();
    const launched = await call("launch_night", {
      ticket: epic.key,
      ...BUDGET,
      stopAt: inHours(4),
    });
    const stopped = await call("stop_night", { ticket: epic.key });
    const status = await call("night_status", { ticket: epic.key });
    expect(launched.data.launch).toMatchObject({ status: "running", budget: BUDGET });
    expect(stopped.data.launch).toMatchObject({ status: "stopping" });
    expect(status.data.launch).toMatchObject({ status: "stopping" });
    expect(status.data.progress.stories).toMatchObject({ total: 1 });
  });

  it("GivenATicketThatIsNotAnEpic_WhenNightStatusIsRead_ThenAnError", async () => {
    const { call, child } = await setup();
    const { isError, text } = await call("night_status", { ticket: child.key });
    expect(isError).toBe(true);
    expect(text).toBe(`${child.key} is not an epic`);
  });

  it("GivenNoLaunchStore_WhenToolsAreListed_ThenTheNightToolsAreAbsent", async () => {
    const { call, epic } = await setup({ store: false });
    const { isError, text } = await call("night_status", { ticket: epic.key });
    expect(isError).toBe(true);
    expect(text).toContain("night_status");
  });
});
