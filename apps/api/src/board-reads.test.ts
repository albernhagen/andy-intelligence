import {
  InMemoryCodeEventLog,
  InMemoryCodeHostConnectionStore,
  InMemoryProjectVersions,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { countReads } from "@andy/contracts/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { parseAllowList } from "./auth";
import { ownerOnlyAccess } from "./project-access";

/**
 * AI-317: Board and ticket list re-read every ticket after any change. Documents read by the
 * board and the ticket list, cold, unchanged, and after one and ten ticket writes, at two project
 * sizes: after the first read, they must not grow with the number of tickets.
 */

const MINUTE = 60_000;

async function setup(size: number) {
  // Tickets made two minutes apart (as real ones are), with a few in flight showing a PR.
  const clock = { at: Date.parse("2026-11-01T00:00:00.000Z") };
  const raw = new InMemoryWorkTracker(() => new Date(clock.at));
  await raw.createProject({ name: "Andy Intelligence", key: "AI", repos: [] });
  const ids: string[] = [];
  for (let i = 0; i < size; i++) {
    clock.at += 2 * MINUTE;
    const t = await raw.createTicket("ai", { title: `T${i}`, type: "chore" }, "andy");
    ids.push(t.id);
  }
  for (const id of ids.slice(0, 3)) {
    clock.at += 2 * MINUTE;
    await raw.updateTicket(
      "ai",
      id,
      { stage: { to: "in_progress", forced: true, reason: null } },
      "andy",
    );
    await raw.linkPullRequest(
      "ai",
      id,
      { number: 1, url: "https://example.com/pr/1", state: "open" },
      "system",
    );
  }
  for (const id of ids.slice(3, 23)) {
    clock.at += 2 * MINUTE;
    await raw.updateTicket("ai", id, { fields: { archived: true } }, "andy");
  }
  const versions = new InMemoryProjectVersions();
  const stores = {
    tracker: countReads(raw),
    runs: countReads(new InMemoryRunStore()),
    versions: countReads(versions),
  };
  const app = createApp({
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
    projectVersions: stores.versions.store,
    github: {
      publicUrl: "https://cp.example",
      connections: new InMemoryCodeHostConnectionStore(),
      events: new InMemoryCodeEventLog(),
    },
  });
  const reads = () => Object.values(stores).reduce((n, s) => n + s.reads(), 0);
  const reset = () => Object.values(stores).forEach((s) => s.reset());
  /** Reads of one GET, and its body. */
  const get = async (path: string) => {
    reset();
    const res = await app.request(path, { headers: { authorization: "Bearer andy" } });
    expect(res.status, path).toBe(200);
    return { reads: reads(), body: (await res.json()) as { id: string; title: string }[] };
  };
  /** Edits `n` tickets an hour later, bumping the version as the app's writes do. */
  const write = async (n: number) => {
    clock.at += 60 * MINUTE;
    for (const id of ids.slice(-n)) {
      await raw.updateTicket("ai", id, { fields: { title: `Edited ${clock.at}` } }, "andy");
    }
    await versions.bump("ai");
  };
  return { get, write, raw };
}

const BOARD = "/api/projects/ai/board";
const LIST = "/api/projects/ai/tickets?archived=false";

describe("board and ticket list reads (AI-317)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GivenTwoProjectSizes_WhenTheBoardAndListArePolledThroughWrites_ThenReadsAfterTheColdStartDoNotGrowWithTheProject", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const table: Record<string, number[]> = {};
    const note = (row: string, n: number) => (table[row] ??= []).push(n);
    for (const size of [40, 300]) {
      const s = await setup(size);
      note("board, cold start", (await s.get(BOARD)).reads);
      note("list, cold start", (await s.get(LIST)).reads);
      note("board, unchanged", (await s.get(BOARD)).reads);
      note("list, unchanged", (await s.get(LIST)).reads);
      await s.write(1);
      note("board, after one write", (await s.get(BOARD)).reads);
      note("list, after one write", (await s.get(LIST)).reads);
      await s.write(10);
      // This time the list polls first, so it is the one that reads the changed tickets.
      const list = await s.get(LIST);
      note("list, after ten writes", list.reads);
      const board = await s.get(BOARD);
      note("board, after ten writes", board.reads);
      // The merged view is what a full read returns.
      const fresh = await s.raw.listTickets("ai");
      expect(board.body.map((t) => [t.id, t.title])).toEqual(fresh.map((t) => [t.id, t.title]));
      expect(list.body.map((t) => t.id)).toEqual(fresh.filter((t) => !t.archived).map((t) => t.id));
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
      expect(big, row).toBeLessThanOrEqual(20);
    }
  });
});
