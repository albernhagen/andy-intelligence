import {
  InMemoryOAuthGrantStore,
  InMemoryProjectVersions,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { countReads } from "@andy/contracts/testing";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { parseAllowList, type TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";

/**
 * AI-222: Firestore reads grow with project size. Andy's usage alert fired at 25,063 reads in
 * an hour: `status`, board polls and ticket writes read every ticket of a 220-ticket project.
 * These count the documents each path reads, at two project sizes, so a path that reads the
 * whole project again fails.
 */

const PUBLIC_URL = "https://control-plane.example.run.app";
const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

/** A project with `others` filler tickets (half of them archived Done), a story and its blocker. */
async function setup(others: number) {
  const raw = new InMemoryWorkTracker();
  await raw.createProject({ name: "Andy Intelligence", key: "AI" });
  for (let i = 0; i < others; i++) {
    const t = await raw.createTicket("ai", { title: `Filler ${i}`, type: "chore" }, "andy");
    if (i % 2 === 0) {
      await raw.updateTicket(
        "ai",
        t.id,
        { stage: { to: "done", forced: true, reason: null }, fields: { archived: true } },
        "andy",
      );
    }
  }
  const blocker = await raw.createTicket("ai", { title: "Blocker", type: "chore" }, "andy");
  const story = await raw.createTicket(
    "ai",
    { title: "Story", type: "feature", blockedBy: [blocker.key] },
    "andy",
  );
  const tracker = countReads(raw);
  const runs = countReads(new InMemoryRunStore());
  const versions = countReads(new InMemoryProjectVersions());
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker: tracker.store,
    runs: runs.store,
    projectVersions: versions.store,
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
  const reads = () => tracker.reads() + runs.reads() + versions.reads();
  const reset = () => {
    tracker.reset();
    runs.reset();
    versions.reset();
  };
  const get = (path: string) =>
    Promise.resolve(app.request(path, { headers: { authorization: "Bearer andy" } })).then(
      async (r) => {
        expect(r.status).toBe(200);
        return r.json() as Promise<unknown[]>;
      },
    );
  return { app, call, reads, reset, get, story, tracker };
}

/** Documents read by `act` in a fresh project of each size. */
async function readsAt(act: (s: Awaited<ReturnType<typeof setup>>) => Promise<unknown>) {
  const counts: number[] = [];
  for (const others of [10, 200]) {
    const s = await setup(others);
    s.reset();
    await act(s);
    counts.push(s.reads());
  }
  return counts;
}

describe("reads per call (AI-222)", () => {
  it("GivenAStoryWithOneBlocker_WhenStatusIsCalled_ThenReadsStayFlatAsTheProjectGrows", async () => {
    const [small, large] = await readsAt(async (s) => {
      const result = await s.call("status", { ticket: s.story.key });
      expect(result.isError).toBe(false);
      expect(result.data.statusLine.text).toContain("AI-");
    });
    expect(large).toBe(small);
    // The ticket, questions, history, project, runs, in-flight runs and the one blocker.
    expect(large).toBeLessThanOrEqual(10 + 1);
  });

  it("GivenAnUnchangedBoard_WhenPolledAgain_ThenAtMostFiveReadsAtAnySize", async () => {
    const [small, large] = await readsAt(async (s) => {
      await s.get("/api/projects/ai/board");
      s.reset();
      await s.get("/api/projects/ai/board");
    });
    expect(large).toBe(small);
    expect(large).toBe(1);
  });

  it("GivenAnUnchangedTicketList_WhenPolledAgain_ThenAtMostFiveReadsAtAnySize", async () => {
    const [small, large] = await readsAt(async (s) => {
      await s.get("/api/projects/ai/tickets");
      s.reset();
      await s.get("/api/projects/ai/tickets");
    });
    expect(large).toBe(small);
    expect(large).toBeLessThanOrEqual(5);
  });

  it("GivenACachedBoard_WhenATicketChanges_ThenTheNextPollShowsIt", async () => {
    const s = await setup(3);
    await s.get("/api/projects/ai/board");
    await s.call("edit_ticket", { ticket: s.story.key, title: "Story, renamed" });
    const board = (await s.get("/api/projects/ai/board")) as { key: string; title: string }[];
    expect(board.find((t) => t.key === s.story.key)?.title).toBe("Story, renamed");
  });

  it("GivenAProjectWithArchivedTickets_WhenATicketIsCreatedAndMoved_ThenNoArchivedTicketIsRead", async () => {
    const s = await setup(20);
    s.reset();
    const created = await s.call("create_ticket", {
      project: "ai",
      title: "New chore",
      type: "chore",
      parent: undefined,
    });
    expect(created.isError).toBe(false);
    await s.call("move_ticket", { ticket: s.story.key, to: "ready" });
    const archived = s.tracker
      .returned()
      .filter(
        (d): d is { archived: boolean } => typeof d === "object" && d !== null && "archived" in d,
      )
      .filter((t) => t.archived);
    expect(archived).toEqual([]);
  });
});
