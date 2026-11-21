import {
  InMemoryCodeEventLog,
  InMemoryCodeHostConnectionStore,
  InMemoryOAuthGrantStore,
  InMemoryProjectVersions,
  InMemoryReleaseNoteStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { countReads } from "@andy/contracts/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "./app";
import { parseAllowList } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";

/**
 * AI-318: Dashboard, digest, epic status, What's new and milestone map read the whole project per
 * call; AI-319: Needs-you reads every flagged ticket and open question across projects per call. Documents each reads, cold, unchanged, and after one and ten ticket writes, at two project
 * sizes: after the first read they must not grow with the number of tickets, and each returns
 * what a full read (no snapshot) returns.
 */

const MINUTE = 60_000;
const PUBLIC_URL = "https://cp.example";

async function setup(size: number) {
  // Old tickets two minutes apart, months before the windows; a 10-child epic and three in review.
  const clock = { at: Date.parse("2026-03-01T00:00:00.000Z") };
  const now = () => new Date(clock.at);
  const raw = new InMemoryWorkTracker(now);
  await raw.createProject({ name: "Andy Intelligence", key: "AI", repos: [] });
  const step = () => (clock.at += 2 * MINUTE);
  const epic = await raw.createTicket("ai", { title: "Epic", type: "epic" }, "andy");
  for (let i = 0; i < 10; i++) {
    step();
    await raw.createTicket("ai", { title: `Child ${i}`, type: "chore", parentId: epic.id }, "andy");
  }
  for (let i = 0; i < 3; i++) {
    step();
    const t = await raw.createTicket(
      "ai",
      { title: `Review ${i}`, type: "chore", parentId: epic.id },
      "andy",
    );
    await raw.updateTicket(
      "ai",
      t.id,
      { stage: { to: "ready_for_review", forced: true, reason: null } },
      "andy",
    );
    await raw.linkPullRequest(
      "ai",
      t.id,
      { number: 10 + i, url: `https://example.com/pr/${10 + i}`, state: "open" },
      "system",
    );
  }
  // Waiting on Andy (AI-319): a flagged ticket with a question, and one asked on a ticket since
  // archived, which Needs-you hides.
  for (const archived of [false, true]) {
    step();
    const t = await raw.createTicket("ai", { title: "Asks", type: "chore" }, "andy");
    await raw.askQuestion("ai", t.id, { text: "Which way?" }, "andy");
    await raw.updateTicket("ai", t.id, { fields: { needsAttention: true, archived } }, "andy");
  }
  // Finished tickets: a tenth cancelled, a third archived, as in project AI. The last ten, which
  // `write` edits, stay plain so their histories are alike at both sizes.
  const filler: string[] = [];
  for (let i = 0; i < size; i++) {
    step();
    const t = await raw.createTicket("ai", { title: `T${i}`, type: "chore" }, "andy");
    const old = i < size - 10;
    const to = old && i % 10 === 0 ? "cancelled" : "done";
    await raw.updateTicket("ai", t.id, { stage: { to, forced: true, reason: null } }, "andy");
    if (old && i % 3 === 0)
      await raw.updateTicket("ai", t.id, { fields: { archived: true } }, "andy");
    filler.push(t.id);
  }
  clock.at = Date.parse("2026-11-01T00:00:00.000Z");

  const versions = new InMemoryProjectVersions();
  const stores = {
    tracker: countReads(raw),
    runs: countReads(new InMemoryRunStore()),
    versions: countReads(versions),
    notes: countReads(new InMemoryReleaseNoteStore()),
  };
  const grants = new InMemoryOAuthGrantStore();
  const deps = (withVersions: boolean): AppDeps => ({
    projectAccess: ownerOnlyAccess(),
    verifier: {
      async verify() {
        return { uid: "andy", email: "andy@example.com", emailVerified: true };
      },
    },
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker: stores.tracker.store,
    runs: stores.runs.store,
    releaseNotes: stores.notes.store,
    ...(withVersions && { projectVersions: stores.versions.store }),
    github: {
      publicUrl: PUBLIC_URL,
      connections: new InMemoryCodeHostConnectionStore(),
      events: new InMemoryCodeEventLog(),
      now,
    },
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  const app = createApp(deps(true));
  // The same entry points with every ticket read on each call, as before AI-318.
  const full = createApp(deps(false));
  const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
  const reads = () => Object.values(stores).reduce((n, s) => n + s.reads(), 0);
  const reset = () => Object.values(stores).forEach((s) => s.reset());
  const fetch = async (target: typeof app, path: string) => {
    const res = await target.request(path, { headers: { authorization: "Bearer andy" } });
    expect(res.status, path).toBe(200);
    return (await res.json()) as unknown;
  };
  /** Reads of one entry point, and what it returned. */
  const read = async (entry: Entry) => {
    reset();
    const body = entry.mcp
      ? await call(entry.mcp, entry.onEpic ? { ticket: epic.key } : {})
      : await fetch(app, entry.path);
    return { reads: reads(), body };
  };
  /** Edits `n` done tickets an hour later, bumping the version as the app's writes do. */
  const write = async (n: number) => {
    clock.at += 60 * MINUTE;
    for (const id of filler.slice(-n)) {
      await raw.updateTicket("ai", id, { fields: { title: `Edited ${clock.at}` } }, "andy");
    }
    await versions.bump("ai");
  };
  return { read, write, fullRead: (path: string) => fetch(full, path), epic };
}

interface Entry {
  name: string;
  path: string;
  /** Called as this MCP tool instead of a GET. */
  mcp?: string;
  /** The MCP tool is given the epic as its `ticket`. */
  onEpic?: boolean;
}

describe("whole-project reads (AI-318, AI-319)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GivenTwoProjectSizes_WhenEachEntryPointIsReadThroughWrites_ThenReadsAfterTheColdStartDoNotGrowWithTheProject", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const table: Record<string, number[]> = {};
    const note = (row: string, n: number) => (table[row] ??= []).push(n);
    for (const size of [40, 300]) {
      const s = await setup(size);
      const entries: Entry[] = [
        { name: "dashboard", path: "/api/projects/ai/dashboard" },
        { name: "digest", path: "/api/projects/ai/digest" },
        { name: "epic status", path: `/api/projects/ai/tickets/${s.epic.id}/epic` },
        { name: "epic status (MCP)", path: "", mcp: "status", onEpic: true },
        { name: "what's new", path: "/api/projects/ai/whats-new" },
        { name: "milestone map", path: "/api/projects/ai/milestone-map" },
        // AI-319: Needs-you, across projects, and the inbox count in the overview.
        { name: "needs-you", path: "/api/needs-you" },
        { name: "needs-you (MCP)", path: "", mcp: "list_needs_me" },
        { name: "overview status (MCP)", path: "", mcp: "status" },
      ];
      const round = async (label: string) => {
        for (const e of entries) note(`${e.name}, ${label}`, (await s.read(e)).reads);
      };
      await round("cold start");
      await round("unchanged");
      await s.write(1);
      await round("after one write");
      await s.write(10);
      for (const e of entries) {
        const { reads, body } = await s.read(e);
        note(`${e.name}, after ten writes`, reads);
        if (!e.mcp) expect(body, e.name).toEqual(await s.fullRead(e.path));
      }
    }
    if (process.env.READS_REPORT === "1") {
      const rows = Object.entries(table).map(([k, [a, b]]) => `| ${k} | ${a} | ${b} |`);
      process.stdout.write(
        `\n| Read | 40 tickets | 300 tickets |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
      );
    }
    for (const [row, [small, big]] of Object.entries(table)) {
      if (row.endsWith("cold start")) continue;
      expect(big, row).toBe(small);
      expect(big, row).toBeLessThanOrEqual(60);
    }
  });
});
