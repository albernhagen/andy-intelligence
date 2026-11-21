import {
  InMemoryCodeEventLog,
  InMemoryCodeHostConnectionStore,
  InMemoryOAuthGrantStore,
  InMemoryProjectVersions,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type Stage,
} from "@andy/contracts";
import { countReads } from "@andy/contracts/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "./app";
import { parseAllowList } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { ownerOnlyAccess } from "./project-access";
import { createServices } from "./services";

/**
 * AI-315: Firestore reads still scale with ticket activity. A dispatch event runs after every
 * move to Ready, answer, agent-task end and PR-webhook move; it read every ticket of the project
 * (658 documents at project AI's size). It now reads only the lanes it uses, so its reads don't
 * grow with Done, Cancelled or archived tickets.
 */

const PUBLIC_URL = "https://control-plane.example.run.app";

/** A project with fixed working lanes and `finished` Done tickets (half archived). */
async function setup(finished: number) {
  const raw = new InMemoryWorkTracker();
  await raw.createProject({ name: "Andy Intelligence", key: "AI", repos: ["albernhagen/ai"] });
  await raw.updateProject("ai", { autoRefine: true, autoBuild: true, buildEnabled: true });
  const at = async (stage: Stage, title: string) => {
    const t = await raw.createTicket("ai", { title, type: "chore", body: "x" }, "andy");
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
  for (let i = 0; i < finished; i++) {
    const t = await at(i % 3 === 0 ? "cancelled" : "done", `Finished ${i}`);
    if (i % 2 === 0) await raw.updateTicket("ai", t.id, { fields: { archived: true } }, "andy");
  }
  for (let i = 0; i < 20; i++) await at("backlog", `Idea ${i}`);
  for (let i = 0; i < 3; i++) await at("ready", `Ready ${i}`);
  for (let i = 0; i < 2; i++) await at("in_progress", `Building ${i}`);
  for (let i = 0; i < 2; i++) await at("ready_for_review", `In review ${i}`);
  const touched = await at("backlog", "Touched");

  const tracker = countReads(raw);
  const runs = countReads(new InMemoryRunStore());
  const deps: AppDeps = {
    projectAccess: ownerOnlyAccess(),
    verifier: { verify: () => Promise.reject(new Error("unused")) },
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker: tracker.store,
    runs: runs.store,
    projectVersions: new InMemoryProjectVersions(),
    // With GitHub configured the build dispatcher runs, as in production.
    github: {
      publicUrl: PUBLIC_URL,
      connections: new InMemoryCodeHostConnectionStore(),
      events: new InMemoryCodeEventLog(),
    },
    mcp: {
      publicUrl: PUBLIC_URL,
      grants: new InMemoryOAuthGrantStore(),
      clients: new ClientMetadataResolver(),
    },
  };
  const services = createServices(deps);
  return { raw, tracker, runs, services, touched, deps };
}

describe("dispatch reads (AI-315)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GivenATicketWasJustWritten_WhenADispatchRuns_ThenItsReadsStayFlatAsFinishedTicketsGrow", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const counts: number[] = [];
    for (const finished of [10, 300]) {
      const s = await setup(finished);
      await s.raw.updateTicket("ai", s.touched.id, { fields: { title: "Touched again" } }, "andy");
      s.tracker.reset();
      s.runs.reset();
      await s.services.dispatchNext("ai");
      counts.push(s.tracker.reads() + s.runs.reads());
      const archived = s.tracker
        .returned()
        .filter((d) => typeof d === "object" && d !== null && "archived" in d)
        .filter((t) => (t as { archived: boolean }).archived);
      expect(archived).toEqual([]);
    }
    expect(counts[1]).toBe(counts[0]);
    // The Ready, In progress and Ready for review lanes and their tasks: not the project.
    expect(counts[1]).toBeLessThan(60);
  });

  it("GivenADispatch_WhenItRuns_ThenItLogsTheDocumentsItRead", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await setup(5);
    await s.services.dispatchNext("ai");
    const logged = lines
      .map((l) => JSON.parse(l) as { message?: string; projectId?: string; reads?: number })
      .find((l) => l.message === "dispatch reads");
    expect(logged).toMatchObject({ projectId: "ai" });
    expect(logged!.reads).toBeGreaterThan(0);
  });

  it("GivenARequest_WhenItReadsDocuments_ThenOneLineNamesItsRouteAndReads", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    const s = await setup(5);
    const app = createApp({
      ...s.deps,
      verifier: {
        async verify() {
          return { uid: "andy", email: "andy@example.com", emailVerified: true };
        },
      },
    });
    const res = await app.request("/api/projects/ai/tickets", {
      headers: { authorization: "Bearer andy" },
    });
    expect(res.status).toBe(200);
    const logged = lines
      .map((l) => {
        try {
          return JSON.parse(l) as { message?: string; route?: string; reads?: number };
        } catch {
          return {};
        }
      })
      .find((l) => l.message === "request reads");
    expect(logged).toMatchObject({ route: "/api/projects/:projectId/tickets", status: 200 });
    expect(logged!.reads).toBeGreaterThan(0);
  });
});
