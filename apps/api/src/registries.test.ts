import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import * as apiRoutes from "./api-routes";
import * as toolGroups from "./mcp/tool-groups";
import { hashToken, newToken } from "./mcp/tokens";
import {
  CROSS_PROJECT_ROUTES,
  CROSS_PROJECT_TOOLS,
  isProjectRoute,
  projectOfPath,
  TICKET_KEY_FIELDS,
} from "./project-access";
import * as publicRoutes from "./public-routes";
import { fullApp, registrySnapshot } from "./registry-snapshot";

/**
 * AI-145: routes, MCP tools and package exports register from their own modules, listed one line
 * each in a sorted file, so parallel PRs don't edit the same lines. These tests keep it that way.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(SRC, "../../..");

/** Every non-test .ts file under `dir`, as paths relative to SRC without the extension. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [relative(SRC, path).replace(/\.ts$/, "")];
  });
}

/** The module paths an `export … from "…"` file names, in file order. */
function exportedModules(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/^export [^;]*? from "(\.[^"]+)";/gms)].map((m) => m[1]!);
}

const sorted = (xs: string[]) => [...xs].sort();

/** True when some concrete request path matches both route patterns. */
function overlaps(a: string, b: string): boolean {
  const pa = a.split("/");
  const pb = b.split("/");
  if (pa.length !== pb.length) return false;
  return pa.every((s, i) => s === pb[i] || s.startsWith(":") || pb[i]!.startsWith(":"));
}

describe("code registries (AI-145)", () => {
  it("GivenAModuleExportingRoutes_WhenTheListsAreRead_ThenItIsListed", async () => {
    const listed = {
      apiRoutes: Object.values(apiRoutes),
      publicRoutes: Object.values(publicRoutes),
    };
    const missing: string[] = [];
    // Only modules that declare routes are imported (main.ts would start a server).
    const declaring = sourceFiles(SRC).filter((f) =>
      /^export const (apiRoutes|publicRoutes)\b/m.test(readFileSync(join(SRC, `${f}.ts`), "utf8")),
    );
    expect(declaring.length).toBeGreaterThan(10);
    for (const file of declaring) {
      const mod = (await import(pathToFileURL(join(SRC, `${file}.ts`)).href)) as Record<
        string,
        unknown
      >;
      for (const kind of ["apiRoutes", "publicRoutes"] as const) {
        if (kind in mod && !listed[kind].includes(mod[kind] as never)) {
          missing.push(`${file}: ${kind}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("GivenAToolModule_WhenTheGroupsAreRead_ThenItIsListed", async () => {
    const listed: unknown[] = Object.values(toolGroups);
    const missing: string[] = [];
    for (const file of sourceFiles(join(SRC, "mcp")).filter((f) => /^mcp\/tools-/.test(f))) {
      const mod = (await import(pathToFileURL(join(SRC, `${file}.ts`)).href)) as Record<
        string,
        unknown
      >;
      const registers = Object.entries(mod).filter(([name]) => /^register\w*Tools$/.test(name));
      if (registers.length === 0 || !registers.every(([, fn]) => listed.includes(fn))) {
        missing.push(file);
      }
    }
    expect(missing).toEqual([]);
  });

  // Package barrels are generated from their folders (ADR-0130): scripts/gen-exports.test.mjs.
  it("GivenTheRegistryFiles_WhenRead_ThenEachListIsSortedByModulePath", () => {
    const files = [
      "apps/api/src/api-routes.ts",
      "apps/api/src/public-routes.ts",
      "apps/api/src/mcp/tool-groups.ts",
    ];
    for (const file of files) {
      const modules = exportedModules(join(REPO, file));
      expect(modules.length, file).toBeGreaterThan(0);
      expect(modules, `${file}: insert the new line in sorted order`).toEqual(sorted(modules));
    }
  });

  it("GivenEveryFeatureOn_WhenRoutesAreCompared_ThenNoTwoCanMatchTheSameRequest", async () => {
    // So the route lists' order is not significant: Hono runs handlers in registration order.
    const { routes } = await registrySnapshot();
    const handlers = [...new Set(routes.filter((r) => !r.includes("*")))].map((r) => {
      const [method, path] = r.split(" ") as [string, string];
      return { method, path };
    });
    const clashes = handlers.flatMap((a, i) =>
      handlers
        .slice(i + 1)
        .filter((b) => a.path !== b.path && overlaps(a.path, b.path))
        .filter((b) => a.method === b.method || a.method === "ALL" || b.method === "ALL")
        .map((b) => `${a.method} ${a.path} ~ ${b.method} ${b.path}`),
    );
    expect(clashes).toEqual([]);
  });

  it("GivenEveryFeatureOn_WhenRoutesAreListed_ThenNoApiPathIsRegisteredBeforeSignIn", async () => {
    const { routes } = await registrySnapshot();
    const signIn = routes.indexOf("ALL /api/*");
    expect(signIn).toBeGreaterThan(0);
    expect(routes.slice(0, signIn).filter((r) => r.includes(" /api/"))).toEqual([]);
  });

  it("GivenEveryFeatureOn_WhenEachPublicRouteIsCalledWithoutCredentials_ThenItIsRefused", async () => {
    // Public routes skip the /api sign-in, so each must refuse an anonymous caller itself:
    // 401, or 503 while its secret isn't configured (the webhook without the GitHub App's).
    const open = new Set(["/health", "/config.json"]);
    const { routes } = await registrySnapshot();
    const { app } = fullApp();
    const publicHandlers = [
      ...new Set(routes.slice(0, routes.indexOf("ALL /api/*")).filter((r) => !r.includes("*"))),
    ];
    const accepted: string[] = [];
    for (const route of publicHandlers) {
      const [method, path] = route.split(" ") as [string, string];
      if (open.has(path)) continue;
      const res = await app.request(`http://localhost${path.replace(/:[^/]+/g, "x")}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });
      if (![401, 403, 503].includes(res.status)) accepted.push(`${route}: ${res.status}`);
    }
    expect(publicHandlers.length).toBeGreaterThan(open.size);
    expect(accepted).toEqual([]);
  });

  it("GivenASourceFileThatRegistersRoutesOrTools_WhenRead_ThenARegistryReachesIt", () => {
    // Catches a module that registers routes under another export name: it must declare
    // `apiRoutes`/`publicRoutes` or be imported by a module that does. main.ts serves the SPA.
    const text = (f: string) => readFileSync(join(SRC, `${f}.ts`), "utf8");
    const files = sourceFiles(SRC);
    const declaring = files.filter((f) =>
      /^export const (apiRoutes|publicRoutes)\b/m.test(text(f)),
    );
    const importedBy = (f: string, by: string) => {
      const rel = relative(join(SRC, by, ".."), join(SRC, f));
      const spec = rel.startsWith(".") ? rel : `./${rel}`;
      return text(by).includes(`from "${spec}"`);
    };
    const orphans = files
      .filter((f) => /\bapp\.(openapi|get|post|put|patch|delete|all)\(/.test(text(f)))
      .filter((f) => !["app", "main"].includes(f) && !declaring.includes(f))
      .filter((f) => !declaring.some((d) => importedBy(f, d)));
    expect(orphans).toEqual([]);
    const toolFiles = files.filter((f) => /\.registerTool\(/.test(text(f)));
    expect(toolFiles.filter((f) => !/^mcp\/tools-/.test(f))).toEqual([]);
  });

  it("GivenEveryFeatureOn_WhenRoutesAfterSignInAreListed_ThenEachIsUnderApiOrAKnownSelfCheckingPath", async () => {
    // The /api/* middleware only guards /api/ paths. These check their own caller (MCP bearer
    // token, OAuth flow) or are public by design; a new one is an entry point (threat model).
    const selfChecking = new Set([
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/mcp",
      "/oauth/authorize",
      "/oauth/token",
      "/openapi.json",
    ]);
    const { routes } = await registrySnapshot();
    const afterSignIn = routes.slice(routes.indexOf("ALL /api/*")).map((r) => r.split(" ")[1]!);
    const unguarded = afterSignIn.filter((p) => !p.startsWith("/api/") && !selfChecking.has(p));
    expect(unguarded).toEqual([]);
  });

  it("GivenEveryFeatureOn_WhenToolsAreListed_ThenEachNameIsServedOnce", async () => {
    const { tools } = await registrySnapshot();
    expect(tools.length).toBeGreaterThan(40);
    expect(new Set(tools).size).toBe(tools.length);
  });
});

/**
 * AI-252: M8.3: every `/api` route and MCP tool that names a project goes through the one
 * project-access check (`project-access.ts`). The rest are listed there (`CROSS_PROJECT_ROUTES`,
 * `CROSS_PROJECT_TOOLS`) with how M8.7 will filter each; at runtime anything else is refused, and
 * these tests catch it first.
 */
/** A concrete path for a route pattern: a ticket key for `:key`, "x" for other params. */
const samplePath = (pattern: string) => pattern.replace(":key", "AI-1").replace(/:[^/]+/g, "x");

/** Every MCP tool the full app serves, with its input's fields and the required ones. */
async function toolInputs(): Promise<
  { name: string; properties: Record<string, unknown>; required: string[] }[]
> {
  const { app, grants } = fullApp();
  const token = newToken();
  await grants.put(hashToken(token), {
    kind: "access",
    clientId: "https://claude.ai/oauth/mcp-client-metadata",
    email: "andy@example.com",
    uid: "andy",
    resource: "http://localhost/mcp",
    scope: "",
    redirectUri: null,
    codeChallenge: null,
    expiresAt: "2999-01-01T00:00:00.000Z",
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (input, init) =>
        app.fetch(input instanceof Request ? input : new Request(input, init)),
    }),
  );
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    name: t.name,
    properties: t.inputSchema.properties ?? {},
    required: t.inputSchema.required ?? [],
  }));
}

describe("project-access registry (AI-252)", () => {
  it("GivenEveryFeatureOn_WhenApiRoutesAreListed_ThenEachIsProjectCheckedOrListedAsCrossProject", async () => {
    const { routes } = await registrySnapshot();
    const api = [...new Set(routes.filter((r) => r.includes(" /api/") && !r.includes("*")))];
    const checked = (route: string) =>
      isProjectRoute(route) && projectOfPath(samplePath(route.split(" ")[1]!)) !== null;
    expect(api.filter((r) => checked(r)).length).toBeGreaterThan(40);
    expect(api.filter((r) => !checked(r) && !(r in CROSS_PROJECT_ROUTES))).toEqual([]);
    const listed = Object.keys(CROSS_PROJECT_ROUTES);
    expect(listed.filter((r) => !api.includes(r) || checked(r))).toEqual([]);
  });

  it("GivenEveryFeatureOn_WhenToolsAreListed_ThenEachIsProjectCheckedOrListedAsCrossProject", async () => {
    const tools = await toolInputs();
    const names = tools.map((t) => t.name);
    const checked = new Set(
      tools
        .filter((t) => t.required.includes("project") || t.required.includes("ticket"))
        .map((t) => t.name),
    );
    expect(checked.size).toBeGreaterThan(35);
    expect(names.filter((n) => !checked.has(n) && !(n in CROSS_PROJECT_TOOLS))).toEqual([]);
    const listed = Object.keys(CROSS_PROJECT_TOOLS);
    expect(listed.filter((n) => !names.includes(n) || checked.has(n))).toEqual([]);
  });

  it("GivenEveryFeatureOn_WhenToolInputsAreRead_ThenEveryTicketKeyFieldIsOneTheCheckReads", async () => {
    // A field whose JSON schema (or its items, or a nullable branch) has the ticket-key pattern.
    const KEY_PATTERN = "^[A-Z][A-Z0-9]{0,9}-\\d+$";
    const holdsKey = (schema: unknown): boolean =>
      typeof schema === "object" && schema !== null
        ? Object.entries(schema).some(
            ([k, v]) => (k === "pattern" && v === KEY_PATTERN) || holdsKey(v),
          )
        : false;
    const keyed = (await toolInputs()).flatMap((t) =>
      Object.entries(t.properties)
        .filter(([, schema]) => holdsKey(schema))
        .map(([field]) => ({ field, at: `${t.name}.${field}` })),
    );
    expect(keyed.map((k) => k.at)).toEqual(
      expect.arrayContaining([
        "edit_ticket.blockedBy",
        "set_ticket_parent.parent",
        "reorder_ticket.above",
      ]),
    );
    const unchecked = keyed.filter((k) => !TICKET_KEY_FIELDS.includes(k.field)).map((k) => k.at);
    expect(unchecked).toEqual([]);
  });
});
