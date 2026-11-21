import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fullApp } from "./registry-snapshot";
import {
  REGENERATE,
  documentedEntries,
  reference,
  renderReference,
  routeRows,
  toolRow,
  undocumentedRoutes,
} from "./reference";

const SECURITY_DOCS = join(import.meta.dirname, "..", "..", "..", "docs", "security");

describe("toolRow", () => {
  it.each([
    ["Answers an open question. Andy only.", "Answers an open question."],
    [
      "Owner only. Renders the brief (docs/product/brief.md). More.",
      "Renders the brief (docs/product/brief.md).",
    ],
    ["Lists `cards` across projects", "Lists `cards` across projects"],
  ])("GivenDescription%s_WhenRead_ThenTheSummaryIsItsFirstRealSentence", (description, summary) => {
    expect(toolRow({ name: "t", description })).toEqual({ name: "t", summary });
  });
});

describe("routeRows", () => {
  it("GivenRoutesAroundTheSignInMiddleware_WhenRead_ThenOncEachAndOnlyApiAfterItIsSignedIn", () => {
    const rows = routeRows([
      { method: "ALL", path: "/*" },
      { method: "POST", path: "/runs/:runId/report" },
      { method: "POST", path: "/runs/:runId/report" },
      { method: "ALL", path: "/api/*" },
      { method: "GET", path: "/api/me" },
      { method: "ALL", path: "/mcp" },
    ]);
    expect(rows).toEqual([
      { method: "POST", path: "/runs/:runId/report", signedIn: false },
      { method: "GET", path: "/api/me", signedIn: true },
      { method: "ALL", path: "/mcp", signedIn: false },
    ]);
  });

  it("GivenNoSignInMiddleware_WhenRead_ThenThrows", () => {
    expect(() => routeRows([{ method: "GET", path: "/api/me" }])).toThrow("sign-in");
  });
});

describe("renderReference", () => {
  it("GivenToolsAndRoutes_WhenRendered_ThenSortedWithPipesEscaped", () => {
    const text = renderReference(
      [
        { name: "b_tool", summary: "B." },
        { name: "a_tool", summary: "x | y" },
      ],
      [
        { method: "POST", path: "/z", signedIn: false },
        { method: "GET", path: "/api/a", signedIn: true },
      ],
    );
    expect(text.indexOf("`a_tool`")).toBeLessThan(text.indexOf("`b_tool`"));
    expect(text).toContain("| `a_tool` | x \\| y |");
    expect(text.indexOf("`/api/a`")).toBeLessThan(text.indexOf("`/z`"));
    expect(text).toContain("| POST | `/z` | no |");
    expect(text).toContain(REGENERATE);
  });
});

describe("documented entry points", () => {
  const docs = (text: string) => {
    const dir = mkdtempSync(join(tmpdir(), "reference-docs-"));
    writeFileSync(join(dir, "area.md"), text);
    return documentedEntries(dir);
  };
  const entryTable = (...rows: string[]) =>
    ["| Entry point | Who | Authn |", "| --- | --- | --- |", ...rows].join("\n");
  const route = (method: string, path: string) => ({ method, path, signedIn: false });

  it("GivenEntryRowsWithParamsAndATrailingGlob_WhenMatched_ThenThoseRoutesAreDocumented", () => {
    const entries = docs(
      entryTable(
        "| Run callbacks `POST /runs/{id}/report`, `GET …/context` | Internet | OIDC |",
        "| MCP (`/.well-known/oauth-*`) | Internet | OAuth |",
      ),
    );
    const routes = [
      route("POST", "/runs/:runId/report"),
      route("GET", "/.well-known/oauth-protected-resource/mcp"),
    ];
    expect(undocumentedRoutes(routes, entries)).toEqual([]);
  });

  it.each([
    ["only in prose", `Prose naming \`/admin/export\`.\n\n${entryTable("| Other `/x` | a | b |")}`],
    [
      "only in another table",
      "| Identity / secret | Grants |\n| --- | --- |\n| Token | `/admin/export` |",
    ],
    ["in an entry row with another method", entryTable("| Export `POST /admin/export` | a | b |")],
    ["only as a pattern with no literal segment", entryTable("| Anything `/*`, `/{id}` | a | b |")],
  ])("GivenAPublicRouteNamed%s_WhenMatched_ThenItIsReported", (_, text) => {
    expect(undocumentedRoutes([route("GET", "/admin/export")], docs(text))).toEqual([
      "GET /admin/export",
    ]);
  });

  it("GivenAGlobInTheMiddleOfAPath_WhenMatched_ThenItStaysWithinOneSegment", () => {
    const entries = docs(entryTable("| Hooks `/hooks/*/in` | a | b |"));
    expect(
      undocumentedRoutes([route("POST", "/hooks/a/in"), route("POST", "/hooks/a/b/in")], entries),
    ).toEqual(["POST /hooks/a/b/in"]);
  });
});

// AI-146: the reference is printed, not committed; these keep it and the docs honest.
describe("this app's reference", () => {
  it("GivenTheApp_WhenTheReferenceIsBuilt_ThenEveryToolHasASummaryAndUniqueName", async () => {
    const { tools } = await reference();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.filter((t) => !t.summary).map((t) => t.name)).toEqual([]);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
  });

  it("GivenEveryRouteOutsideTheSignIn_WhenTheSecurityDocsAreRead_ThenEachIsNamedThere", async () => {
    const { routes } = await reference();
    const missing = undocumentedRoutes(routes, documentedEntries(SECURITY_DOCS));
    expect(
      missing,
      `Routes outside the /api sign-in need a row in an entry-point table in docs/security/ saying who can reach them and how (list: ${REGENERATE})`,
    ).toEqual([]);
  });

  // The "Signed in" column comes from registration order; prove each such route refuses no token.
  it("GivenEverySignedInRoute_WhenCalledWithoutAToken_Then401", async () => {
    const { routes } = await reference();
    const { app } = fullApp();
    const open: string[] = [];
    for (const r of routes.filter((x) => x.signedIn)) {
      const path = r.path.replace(/:\w+/g, "x");
      const res = await app.request(`http://localhost${path}`, { method: r.method });
      if (res.status !== 401) open.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(open).toEqual([]);
  });
});
