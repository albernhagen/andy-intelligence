import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REGENERATE,
  documentedPatterns,
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
    return documentedPatterns(dir);
  };

  it("GivenDocsNamingPathsWithParamsAndGlobs_WhenMatched_ThenOnlyUnnamedPublicRoutesAreReported", () => {
    const patterns = docs("| `POST /runs/{id}/report` | `/.well-known/oauth-*` | `GET …/context`");
    const missing = undocumentedRoutes(
      [
        { method: "POST", path: "/runs/:runId/report", signedIn: false },
        { method: "GET", path: "/.well-known/oauth-authorization-server", signedIn: false },
        { method: "GET", path: "/openapi.json", signedIn: false },
        { method: "GET", path: "/api/undocumented", signedIn: true },
      ],
      patterns,
    );
    expect(missing).toEqual(["GET /openapi.json"]);
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
    const missing = undocumentedRoutes(routes, documentedPatterns(SECURITY_DOCS));
    expect(
      missing,
      `Routes outside the /api sign-in must say who can reach them and how in docs/security/ (list: ${REGENERATE})`,
    ).toEqual([]);
  });
});
