import { InMemoryOAuthGrantStore, InMemoryWorkTracker, type EventActor } from "@andy/contracts";
import { Hono } from "hono";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp, type AppDeps } from "./app";
import type { AuthEnv, TokenVerifier } from "./auth";
import * as toolGroups from "./mcp/tool-groups";
import { mcpCaller } from "./mcp/test-client";
import { hashToken, newToken } from "./mcp/tokens";
import { registerTools, run, withProjectAccess, type ToolDeps, type ToolGroup } from "./mcp/tools";
import {
  ownerOnlyAccess,
  projectOfPath,
  projectsOfInput,
  projectsOfQuery,
  requireProjectAccess,
  type ProjectAccess,
} from "./project-access";
import { fullApp, fullAppDeps, registrySnapshot } from "./registry-snapshot";
import { createServices } from "./services";

/** AI-252: M8.3: one project-access check for API routes and MCP tools; today nothing changes. */

const ANDY: EventActor = "user:andy";

// Andy is on the allow-list; Mallory is signed in (verified email) but not on it.
const verifier: TokenVerifier = {
  verify(token) {
    if (token === "andy") {
      return Promise.resolve({ uid: "andy", email: "andy@example.com", emailVerified: true });
    }
    if (token === "mallory") {
      return Promise.resolve({ uid: "mallory", email: "mallory@example.com", emailVerified: true });
    }
    return Promise.reject(new Error("bad token"));
  },
};

/** A ProjectAccess that refuses every project (or allows, with `allow`) and records each ask. */
function recordingAccess(allow = false) {
  const asked: [EventActor, string][] = [];
  const access: ProjectAccess = {
    canRead(actor, projectId) {
      asked.push([actor, projectId]);
      return Promise.resolve(allow);
    },
  };
  return { access, asked };
}

/** A concrete path for a route pattern: project "ai", ticket key "AI-1", "x" for other ids. */
const samplePath = (pattern: string) =>
  pattern
    .replace(":projectId", "ai")
    .replace(":key", "AI-1")
    .replace(/:[^/]+/g, "x");

/** Every signed-in `/api` route the full app serves, as method and sample path. */
async function apiRoutes(): Promise<{ route: string; method: string; path: string }[]> {
  const { routes } = await registrySnapshot();
  return [...new Set(routes.filter((r) => r.includes(" /api/") && !r.includes("*")))].map(
    (route) => {
      const [method, pattern] = route.split(" ") as [string, string];
      return { route, method, path: samplePath(pattern) };
    },
  );
}

async function seededApp(overrides: Partial<AppDeps>) {
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ key: "AI", name: "andy-intelligence", repos: [] });
  const { app, grants } = fullApp({ verifier, tracker, ...overrides });
  return { app, grants, tracker };
}

function call(
  app: { request: (url: string, init: RequestInit) => Response | Promise<Response> },
  method: string,
  path: string,
  token?: string,
) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: method === "GET" ? undefined : "{}",
  });
}

afterEach(() => vi.restoreAllMocks());

describe("createApp's project-access rule (AI-252)", () => {
  it("GivenNoRule_WhenTheAppIsCreated_ThenItDoesNotTypecheckAndThrowsAtStartUp", () => {
    const copy: Partial<AppDeps> = fullAppDeps();
    delete copy.projectAccess;
    // Every other field is there, so the only type error below is the missing rule.
    const withoutRule = copy as Omit<AppDeps, "projectAccess">;
    // @ts-expect-error -- projectAccess is required: there is no default rule (fail closed).
    expect(() => createApp(withoutRule)).toThrow("createApp needs a projectAccess rule");
  });
});

describe("projectOfPath (AI-252)", () => {
  it("GivenProjectAndTicketPaths_WhenRead_ThenTheirProjectAndUnknownBodyAreNamed", () => {
    expect(projectOfPath("/api/projects/ai")).toEqual({
      projectId: "ai",
      error: "project not found",
    });
    expect(projectOfPath("/api/projects/ai/tickets/t1/runs")?.projectId).toBe("ai");
    expect(projectOfPath("/api/projects/a%20b/board")?.projectId).toBe("a b");
    expect(projectOfPath("/api/tickets/AI-42")).toEqual({
      projectId: "ai",
      error: "ticket not found: AI-42",
    });
  });

  it("GivenPathsThatNameNoProject_WhenRead_ThenNull", () => {
    for (const path of ["/api/projects", "/api/me", "/api/needs-you", "/api/tickets/nope"]) {
      expect(projectOfPath(path), path).toBeNull();
    }
  });
});

describe("projectsOfInput (AI-252)", () => {
  it("GivenAProjectOrTicketInput_WhenRead_ThenEachProjectIsNamed", () => {
    expect(projectsOfInput({ project: "AI" })).toEqual([
      { projectId: "ai", error: "project AI not found" },
    ]);
    expect(projectsOfInput({ ticket: "OPS-7" })).toEqual([
      { projectId: "ops", error: "ticket not found: OPS-7" },
    ]);
    expect(projectsOfInput({ project: "AI", ticket: "OPS-7" }).map((t) => t.projectId)).toEqual([
      "ai",
      "ops",
    ]);
  });

  it("GivenOtherTicketKeyFields_WhenRead_ThenEachKeysProjectIsNamed", () => {
    const input = { ticket: "AI-1", parent: "OPS-2", blockedBy: ["WEB-3", "AI-4"], above: "X-5" };
    expect(projectsOfInput(input).map((t) => t.projectId)).toEqual(["ai", "ops", "web", "ai", "x"]);
    expect(projectsOfInput({ project: "AI", epic: "OPS-9" }).map((t) => t.projectId)).toEqual([
      "ai",
      "ops",
    ]);
    expect(projectsOfInput({ parentId: "t-123", parent: null })).toEqual([]);
  });

  it("GivenInputWithoutAProjectOrTicket_WhenRead_ThenNothingIsNamed", () => {
    expect(projectsOfInput(undefined)).toEqual([]);
    expect(projectsOfInput({ questionId: "q1" })).toEqual([]);
    expect(projectsOfInput({ ticket: "not a key" })).toEqual([]);
  });
});

describe("projectsOfQuery (AI-252)", () => {
  it("GivenProjectQueryParameters_WhenRead_ThenEachValueIsAProject", () => {
    expect(projectsOfQuery({ project: ["ops"], projectId: ["AI", "web"], view: ["mine"] })).toEqual(
      [
        { projectId: "ops", error: "project not found" },
        { projectId: "ai", error: "project not found" },
        { projectId: "web", error: "project not found" },
      ],
    );
    expect(projectsOfQuery({ view: ["mine"] })).toEqual([]);
  });
});

describe("requireProjectAccess (AI-252)", () => {
  function miniApp(access: ProjectAccess) {
    const handler = vi.fn(() => new Response("handled", { status: 201 }));
    const app = new Hono<AuthEnv>();
    app.use("*", async (c, next) => {
      c.set("identity", { uid: "andy", email: "andy@example.com", emailVerified: true });
      await next();
    });
    app.use("/api/*", requireProjectAccess(access));
    app.get("/api/projects/:projectId/board", handler);
    app.get("/api/me", handler);
    app.get("/api/unlisted", handler);
    return { app, handler };
  }

  it("GivenARefusal_WhenAProjectRouteIsCalledWithHead_ThenNotFoundWithoutItsHandler", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { app, handler } = miniApp(recordingAccess().access);
    const res = await app.request("http://localhost/api/projects/ops/board", { method: "HEAD" });
    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
    const unlisted = await app.request("http://localhost/api/unlisted", { method: "HEAD" });
    expect(unlisted.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("GivenARouteWithNoProjectInItsPathThatIsNotListed_WhenCalled_ThenRefusedWithoutItsHandler", async () => {
    const error = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { app, handler } = miniApp(ownerOnlyAccess());
    const res = await app.request("http://localhost/api/unlisted");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(handler).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toContain("route has no project scope");
  });

  it("GivenAListedCrossProjectRoute_WhenCalled_ThenItsHandlerRuns", async () => {
    const { app, handler } = miniApp(recordingAccess().access);
    expect((await app.request("http://localhost/api/me")).status).toBe(201);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("GivenTodaysAllowAll_WhenAProjectRouteIsCalled_ThenTheHandlersResponseIsUnchanged", async () => {
    const { app, handler } = miniApp(ownerOnlyAccess());
    const res = await app.request("http://localhost/api/projects/ai/board");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("handled");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("GivenARefusal_WhenAProjectRouteIsCalled_ThenNotFoundIsLoggedWithoutEmailAndTheHandlerSkipped", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { access } = recordingAccess();
    const { app, handler } = miniApp(access);
    const res = await app.request("http://localhost/api/projects/ai/board");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project not found" });
    expect(handler).not.toHaveBeenCalled();
    const line = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ severity: "WARNING", actor: ANDY, projectId: "ai", via: "api" });
    expect(JSON.stringify(line)).not.toContain("@");
  });
});

describe("API routes behind the project-access check (AI-252)", () => {
  it("GivenARefusingAccess_WhenEveryProjectRouteIsCalledByTheOwner_ThenEachAnswersTheUnknownProject404", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { access, asked } = recordingAccess();
    const { app, tracker } = await seededApp({ projectAccess: access });
    const scoped = (await apiRoutes()).filter((r) => projectOfPath(r.path));
    expect(scoped.length).toBeGreaterThan(40);
    const wrong: string[] = [];
    for (const { route, method, path } of scoped) {
      const res = await call(app, method, path, "andy");
      const body = (await res.json()) as { error?: string };
      const expected = path.startsWith("/api/tickets/")
        ? "ticket not found: AI-1"
        : "project not found";
      if (res.status !== 404 || body.error !== expected) wrong.push(`${route}: ${res.status}`);
    }
    expect(wrong).toEqual([]);
    expect(asked).toHaveLength(scoped.length);
    expect(asked.every(([actor, projectId]) => actor === ANDY && projectId === "ai")).toBe(true);
    // No handler ran: the POST to create a ticket created nothing.
    expect(await tracker.listTickets("ai")).toEqual([]);
  });

  it("GivenABodyKeyFromAnUnreadableProject_WhenATicketIsCreatedOrEdited_ThenTheUnknownTicket404AndNothingWritten", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const access: ProjectAccess = {
      canRead: (_, projectId) => Promise.resolve(projectId !== "ops"),
    };
    const { app, tracker } = await seededApp({ projectAccess: access });
    const write = (method: string, path: string, body: unknown, type = "application/json") =>
      app.request(`http://localhost${path}`, {
        method,
        headers: { "content-type": type, authorization: "Bearer andy" },
        body: JSON.stringify(body),
      });
    const created = await write("POST", "/api/projects/ai/tickets", {
      title: "Readable",
      type: "chore",
    });
    expect(created.status).toBe(201);
    const ticket = (await created.json()) as { id: string; updatedAt: string };

    const refusedCreate = await write("POST", "/api/projects/ai/tickets", {
      title: "Blocked elsewhere",
      blockedBy: ["OPS-9"],
    });
    expect(refusedCreate.status).toBe(404);
    expect(await refusedCreate.json()).toEqual({ error: "ticket not found: OPS-9" });
    const refusedEdit = await write("PATCH", `/api/projects/ai/tickets/${ticket.id}`, {
      blockedBy: ["AI-1", "OPS-9"],
    });
    expect(refusedEdit.status).toBe(404);
    // The body is read as JSON whatever the content type says.
    const suffixed = await write(
      "PATCH",
      `/api/projects/ai/tickets/${ticket.id}`,
      { blockedBy: ["OPS-9"] },
      "Application/Merge-Patch+JSON; charset=utf-8",
    );
    expect(suffixed.status).toBe(404);
    const mislabelled = await write(
      "PATCH",
      `/api/projects/ai/tickets/${ticket.id}`,
      { blockedBy: ["OPS-9"] },
      "text/plain",
    );
    expect(mislabelled.status).toBe(404);
    expect(await tracker.listTickets("ai")).toHaveLength(1);
    expect((await tracker.getTicket("ai", ticket.id))?.updatedAt).toBe(ticket.updatedAt);
  });

  it("GivenAQueryNamingAnUnreadableProject_WhenACrossProjectRouteIsCalled_ThenTheUnknownProject404", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const access: ProjectAccess = {
      canRead: (_, projectId) => Promise.resolve(projectId !== "ops"),
    };
    const { app } = await seededApp({ projectAccess: access });
    for (const path of ["/api/work?view=mine&project=ops", "/api/routing?projectId=ops"]) {
      const refused = await call(app, "GET", path, "andy");
      expect(refused.status, path).toBe(404);
      expect(await refused.json()).toEqual({ error: "project not found" });
    }
    for (const path of [
      "/api/work?view=mine&project=ai",
      "/api/routing?projectId=ai",
      "/api/work?view=mine",
    ]) {
      expect((await call(app, "GET", path, "andy")).status, path).toBe(200);
    }
  });

  it("GivenARefusingAccess_WhenEachCrossProjectRouteIsCalled_ThenTheCheckIsNotAsked", async () => {
    const { access, asked } = recordingAccess();
    const { app } = await seededApp({ projectAccess: access });
    const cross = (await apiRoutes()).filter((r) => !projectOfPath(r.path));
    expect(cross.length).toBeGreaterThan(10);
    for (const { method, path } of cross) await call(app, method, path, "andy");
    expect(asked).toEqual([]);
  });

  it("GivenEveryApiRoute_WhenCalledSignedOutOrByANonOwner_ThenRefusedAsTodayBeforeTheCheck", async () => {
    const { access, asked } = recordingAccess(true);
    const { app } = await seededApp({ projectAccess: access });
    const wrong: string[] = [];
    for (const { route, method, path } of await apiRoutes()) {
      const signedOut = await call(app, method, path);
      const nonOwner = await call(app, method, path, "mallory");
      if (signedOut.status !== 401 || nonOwner.status !== 403) {
        wrong.push(`${route}: ${signedOut.status}/${nonOwner.status}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(asked).toEqual([]);
  });
});

/** A server that keeps each registered tool's config and (checked) handler. */
function recordingServer() {
  const tools = new Map<
    string,
    { inputSchema?: Record<string, { isOptional(): boolean }>; cb: (...a: unknown[]) => unknown }
  >();
  const server = {
    registerTool(
      name: string,
      config: { inputSchema?: Record<string, { isOptional(): boolean }> },
      cb: (...a: unknown[]) => unknown,
    ) {
      tools.set(name, { inputSchema: config.inputSchema, cb });
    },
  } as unknown as McpServer;
  return { server, tools };
}

/** Wraps every service so each method call after `reset` is recorded. */
function spied<T extends object>(services: T) {
  const calls: string[] = [];
  const wrap = (value: object, path: string): object =>
    new Proxy(value, {
      get(target, prop) {
        const v = Reflect.get(target, prop) as unknown;
        if (typeof v === "function") {
          return (...args: unknown[]) => {
            calls.push(`${path}.${String(prop)}`);
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return v && typeof v === "object" ? wrap(v, `${path}.${String(prop)}`) : v;
      },
    });
  const deps = Object.fromEntries(
    Object.entries(services).map(([k, v]) => [k, v && typeof v === "object" ? wrap(v, k) : v]),
  ) as T;
  return { deps, calls };
}

describe("MCP tools behind the project-access check (AI-252)", () => {
  async function toolsWith(access: ProjectAccess) {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ key: "AI", name: "andy-intelligence", repos: [] });
    const { deps, calls } = spied(createServices(fullAppDeps(undefined, { tracker })));
    const { server, tools } = recordingServer();
    registerTools(server, {
      ...deps,
      email: "andy@example.com",
      actor: ANDY,
      projectAccess: access,
    } as ToolDeps);
    calls.length = 0;
    return { tools, calls };
  }

  it("GivenARefusingAccess_WhenEveryToolNamingAProjectOrTicketIsCalled_ThenNotFoundWithoutItsHandler", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { access, asked } = recordingAccess();
    const { tools, calls } = await toolsWith(access);
    const wrong: string[] = [];
    let checked = 0;
    for (const [name, { inputSchema, cb }] of tools) {
      const fields = Object.keys(inputSchema ?? {});
      const args = fields.includes("project")
        ? { project: "AI" }
        : fields.includes("ticket")
          ? { ticket: "AI-1" }
          : null;
      if (!args) continue;
      checked += 1;
      const result = (await cb(args, {})) as CallToolResult;
      const text = (result.content[0] as { text: string }).text;
      const expected = "project" in args ? "project AI not found" : "ticket not found: AI-1";
      if (!result.isError || text !== expected) wrong.push(`${name}: ${text}`);
    }
    expect(checked).toBeGreaterThan(35);
    expect(wrong).toEqual([]);
    expect(asked).toHaveLength(checked);
    expect(calls).toEqual([]);
  });

  it("GivenAReadableTicketAndAnUnreadableBlocker_WhenEditTicketIsCalled_ThenTheBlockerIsNotFound", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const access: ProjectAccess = {
      canRead: (_, projectId) => Promise.resolve(projectId !== "ops"),
    };
    const { tools, calls } = await toolsWith(access);
    const result = (await tools
      .get("edit_ticket")!
      .cb({ ticket: "AI-1", blockedBy: ["OPS-9"] }, {})) as CallToolResult;
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe("ticket not found: OPS-9");
    expect(calls).toEqual([]);
  });

  it("GivenAToolNotListedAsCrossProject_WhenCalledWithoutAProject_ThenRefusedWithoutItsHandler", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { server, tools } = recordingServer();
    const checked = withProjectAccess(server, ownerOnlyAccess(), ANDY);
    const handler = vi.fn(() => run(() => Promise.resolve({ ran: true })));
    checked.registerTool("new_tool", {}, handler);
    checked.registerTool(
      "new_optional",
      { inputSchema: { project: z.string().optional() } },
      handler,
    );
    checked.registerTool("list_projects", {}, handler);
    const text = (r: unknown) => ((r as CallToolResult).content[0] as { text: string }).text;
    expect(text(await tools.get("new_tool")!.cb({}))).toBe("not found");
    expect(text(await tools.get("new_optional")!.cb({}, {}))).toBe("not found");
    expect(handler).not.toHaveBeenCalled();
    expect(await tools.get("new_optional")!.cb({ project: "AI" }, {})).toMatchObject({
      structuredContent: { ran: true },
    });
    expect(await tools.get("list_projects")!.cb({})).toMatchObject({
      structuredContent: { ran: true },
    });
  });

  it("GivenTodaysAllowAll_WhenAToolNamingAProjectIsCalled_ThenItsHandlerRuns", async () => {
    const { tools } = await toolsWith(ownerOnlyAccess());
    const result = (await tools
      .get("get_project_settings")!
      .cb({ project: "AI" }, {})) as CallToolResult;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ project: "AI" });
  });

  it("GivenTheAppsProjectAccessRefuses_WhenAToolIsCalledThroughTheMcpEndpoint_ThenNotFound", async () => {
    // The app passes its one check to MCP too, not only to /api.
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { access, asked } = recordingAccess();
    const { app, grants } = await seededApp({ projectAccess: access });
    const callTool = await mcpCaller(app, grants, "http://localhost/mcp");
    const result = await callTool("get_project_settings", { project: "AI" });
    expect(result).toMatchObject({ isError: true, text: "project AI not found" });
    expect(asked).toEqual([[ANDY, "ai"]]);
  });

  it("GivenEveryToolGroup_WhenItsToolIsCalledSignedOutOrByANonOwner_ThenRefusedAsToday", async () => {
    const grants = new InMemoryOAuthGrantStore();
    const { app } = fullApp({ verifier, mcp: { ...fullAppDeps(grants).mcp!, grants } });
    const nonOwner = newToken();
    await grants.put(hashToken(nonOwner), {
      kind: "access",
      clientId: "https://claude.ai/oauth/mcp-client-metadata",
      email: "mallory@example.com",
      uid: "mallory",
      resource: "http://localhost/mcp",
      scope: "",
      redirectUri: null,
      codeChallenge: null,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    const wrong: string[] = [];
    const groups: Record<string, ToolGroup> = toolGroups;
    for (const [group, register] of Object.entries(groups)) {
      const { server, tools } = recordingServer();
      const deps = createServices(fullAppDeps());
      register(
        server,
        { ...deps, email: "", actor: ANDY, projectAccess: ownerOnlyAccess() } as ToolDeps,
        run,
      );
      const [name] = [...tools.keys()];
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: {} },
      });
      const headers = { "content-type": "application/json", accept: "application/json" };
      const signedOut = await app.request("http://localhost/mcp", {
        method: "POST",
        headers,
        body,
      });
      const refused = await app.request("http://localhost/mcp", {
        method: "POST",
        headers: { ...headers, authorization: `Bearer ${nonOwner}` },
        body,
      });
      if (!name || signedOut.status !== 401 || refused.status !== 401) {
        wrong.push(`${group}/${name}: ${signedOut.status}/${refused.status}`);
      }
    }
    expect(Object.keys(groups).length).toBeGreaterThan(15);
    expect(wrong).toEqual([]);
  });
});
