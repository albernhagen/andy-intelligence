import { InMemoryOAuthGrantStore, InMemoryWorkTracker, type EventActor } from "@andy/contracts";
import { Hono } from "hono";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDeps } from "./app";
import type { AuthEnv, TokenVerifier } from "./auth";
import * as toolGroups from "./mcp/tool-groups";
import { hashToken, newToken } from "./mcp/tokens";
import { registerTools, run, type ToolDeps, type ToolGroup } from "./mcp/tools";
import {
  ALLOW_SIGNED_IN,
  projectOfPath,
  projectsOfToolInput,
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

describe("projectsOfToolInput (AI-252)", () => {
  it("GivenAProjectOrTicketInput_WhenRead_ThenEachProjectIsNamed", () => {
    expect(projectsOfToolInput({ project: "AI" })).toEqual([
      { projectId: "ai", error: "project AI not found" },
    ]);
    expect(projectsOfToolInput({ ticket: "OPS-7" })).toEqual([
      { projectId: "ops", error: "ticket not found: OPS-7" },
    ]);
    expect(projectsOfToolInput({ project: "AI", ticket: "OPS-7" }).map((t) => t.projectId)).toEqual(
      ["ai", "ops"],
    );
  });

  it("GivenInputWithoutAProjectOrTicket_WhenRead_ThenNothingIsNamed", () => {
    expect(projectsOfToolInput(undefined)).toEqual([]);
    expect(projectsOfToolInput({ questionId: "q1" })).toEqual([]);
    expect(projectsOfToolInput({ ticket: "not a key" })).toEqual([]);
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
    app.all("*", handler);
    return { app, handler };
  }

  it("GivenTodaysAllowAll_WhenAProjectRouteIsCalled_ThenTheHandlersResponseIsUnchanged", async () => {
    const { app, handler } = miniApp(ALLOW_SIGNED_IN);
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

  it("GivenTodaysAllowAll_WhenAToolNamingAProjectIsCalled_ThenItsHandlerRuns", async () => {
    const { tools } = await toolsWith(ALLOW_SIGNED_IN);
    const result = (await tools
      .get("get_project_settings")!
      .cb({ project: "AI" }, {})) as CallToolResult;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ project: "AI" });
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
      register(server, { ...deps, email: "", actor: ANDY } as ToolDeps, run);
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
