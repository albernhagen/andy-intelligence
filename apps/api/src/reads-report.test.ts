import {
  InMemoryCodeEventLog,
  InMemoryCodeHostConnectionStore,
  InMemoryOAuthGrantStore,
  InMemoryProjectVersions,
  InMemoryQuotaStore,
  InMemoryReleaseNoteStore,
  InMemoryRoutingConfigStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type Stage,
} from "@andy/contracts";
import { countReads } from "@andy/contracts/testing";
import { describe, it, vi } from "vitest";
import { createApp } from "./app";
import { parseAllowList, type TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";
import { createServices } from "./services";

/**
 * Measurement only (run with READS_REPORT=1): documents read per entry point at project AI's real
 * size (about 315 tickets, a 32-child epic), unchanged and right after a ticket write.
 */

const PUBLIC_URL = "https://control-plane.example.run.app";
const verifier: TokenVerifier = {
  async verify() {
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

async function seed(raw: InMemoryWorkTracker) {
  await raw.createProject({ name: "Andy Intelligence", key: "AI", repos: ["albernhagen/ai"] });
  await raw.updateProject("ai", { autoRefine: true, autoBuild: true, buildEnabled: true });
  const at = async (stage: Stage, i: number, extra: Record<string, unknown> = {}) => {
    const t = await raw.createTicket(
      "ai",
      { title: `Ticket ${i}`, type: "chore", body: "x", ...extra },
      "andy",
    );
    if (stage !== "backlog") {
      await raw.updateTicket(
        "ai",
        t.id,
        { stage: { to: stage, forced: true, reason: null } },
        "andy",
      );
    }
    return t;
  };
  const epic = await raw.createTicket("ai", { title: "Epic", type: "epic" }, "andy");
  let i = 0;
  for (; i < 32; i++) await at(i % 2 ? "done" : "backlog", i, { parentId: epic.id });
  for (; i < 132; i++) {
    const t = await at("done", i);
    await raw.updateTicket("ai", t.id, { fields: { archived: true } }, "andy");
  }
  for (; i < 202; i++) await at("done", i);
  for (; i < 262; i++) await at("backlog", i);
  for (; i < 282; i++) await at("ready", i);
  for (; i < 297; i++) await at("in_progress", i);
  for (; i < 307; i++) await at("ready_for_review", i);
  for (; i < 314; i++) await at("cancelled", i);
  const story = await at("backlog", i);
  const ready = await at("backlog", i + 1, {
    acceptanceCriteria: ["Done when it works."],
    size: "S",
    sizeReason: "Small.",
    upNext: undefined,
  });
  return { epic, story, ready };
}

async function setup() {
  const raw = new InMemoryWorkTracker();
  const { epic, story, ready } = await seed(raw);
  const stores = {
    tracker: countReads(raw),
    runs: countReads(new InMemoryRunStore()),
    versions: countReads(new InMemoryProjectVersions()),
    routing: countReads(new InMemoryRoutingConfigStore()),
    quota: countReads(new InMemoryQuotaStore()),
    notes: countReads(new InMemoryReleaseNoteStore()),
  };
  const grants = new InMemoryOAuthGrantStore();
  const deps = {
    projectAccess: ownerOnlyAccess(),
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker: stores.tracker.store,
    runs: stores.runs.store,
    projectVersions: stores.versions.store,
    routing: stores.routing.store,
    quota: stores.quota.store,
    releaseNotes: stores.notes.store,
    github: {
      publicUrl: PUBLIC_URL,
      connections: new InMemoryCodeHostConnectionStore(),
      events: new InMemoryCodeEventLog(),
    },
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  };
  const app = createApp(deps);
  const services = createServices(deps);
  const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
  const reads = () => Object.values(stores).reduce((n, s) => n + s.reads(), 0);
  const reset = () => Object.values(stores).forEach((s) => s.reset());
  const get = (path: string) =>
    Promise.resolve(app.request(path, { headers: { authorization: "Bearer andy" } }));
  return { call, get, reads, reset, epic, story, services, ready };
}

type S = Awaited<ReturnType<typeof setup>>;

const ENTRIES: [string, (s: S) => Promise<unknown>][] = [
  ["GET board", (s) => s.get("/api/projects/ai/board")],
  ["GET tickets", (s) => s.get("/api/projects/ai/tickets")],
  ["MCP status (story)", (s) => s.call("status", { ticket: s.story.key })],
  ["MCP status (epic, 32)", (s) => s.call("status", { ticket: s.epic.key })],
  ["MCP status (overview)", (s) => s.call("status")],
  ["MCP create_ticket", (s) => s.call("create_ticket", { project: "AI", title: "New" })],
  ["MCP edit_ticket", (s) => s.call("edit_ticket", { ticket: s.story.key, title: "Renamed" })],
  ["dispatchNext (one dispatch event)", (s) => s.services.dispatchNext("ai")],
  [
    "MCP move_ticket to Ready (dispatches)",
    (s) => s.call("move_ticket", { ticket: s.ready.key, to: "ready" }),
  ],
  ["GET digest", (s) => s.get("/api/projects/ai/digest")],
  ["GET needs-you", (s) => s.get("/api/needs-you")],
  ["MCP list_needs_me", (s) => s.call("list_needs_me")],
  ["GET milestone-map", (s) => s.get("/api/projects/ai/milestone-map")],
  ["GET whats-new", (s) => s.get("/api/projects/ai/whats-new")],
  ["GET in-flight", (s) => s.get("/api/projects/ai/in-flight")],
  ["GET work (needs me)", (s) => s.get("/api/work?view=needs-me")],
  ["GET project dashboard", (s) => s.get("/api/projects/ai/dashboard")],
];

describe.runIf(process.env.READS_REPORT === "1")("reads report", () => {
  it("prints documents read per entry point", { timeout: 300_000 }, async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rows: string[] = [];
    for (const [name, act] of ENTRIES) {
      const s = await setup();
      const first = ((await act(s)) ?? {}) as { status?: number; isError?: boolean; text?: string };
      const outcome = first.status ?? (first.isError ? `error: ${first.text?.slice(0, 80)}` : "ok");
      s.reset();
      await act(s);
      const unchanged = s.reads();
      await s.call("edit_ticket", { ticket: `AI-${10}`, title: "Touched" });
      s.reset();
      await act(s);
      rows.push(`| ${name} | ${unchanged} | ${s.reads()} | ${outcome} |`);
    }
    process.stdout.write(
      `\n| Entry point | Unchanged | After a write |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
    );
  });
});
