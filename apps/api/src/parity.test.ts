import { describe, expect, it } from "vitest";
import { mcpToolNames } from "./mcp/test-client";
import { PARITY } from "./parity";
import { fullApp } from "./registry-snapshot";

/**
 * AI-300: every signed-in `/api` route and every MCP tool belongs to an action in `PARITY`, with
 * its counterpart or a recorded reason (epic AI-285: Web UI and MCP parity). The app is built
 * with every optional feature on, so no route or tool hides behind a missing dependency.
 */

async function surface() {
  const { app, grants } = fullApp();
  const routes = new Set(
    app.routes
      .filter((r) => r.method !== "ALL" && r.path.startsWith("/api/"))
      .map((r) => `${r.method} ${r.path}`),
  );
  const tools = new Set(await mcpToolNames(app, grants, "http://localhost/mcp"));
  return { routes, tools };
}

const named = (pick: (e: (typeof PARITY)[number]) => readonly string[]) =>
  new Set(PARITY.flatMap(pick));

describe("Web UI and MCP parity registry (AI-300)", () => {
  it("GivenEverySignedInRoute_WhenLookedUp_ThenEachBelongsToAnAction", async () => {
    const { routes } = await surface();
    const listed = named((e) => e.routes);
    expect([...routes].filter((r) => !listed.has(r)).sort()).toEqual([]);
  });

  it("GivenEveryMcpTool_WhenLookedUp_ThenEachBelongsToAnAction", async () => {
    const { tools } = await surface();
    const listed = named((e) => e.tools);
    expect([...tools].filter((t) => !listed.has(t)).sort()).toEqual([]);
  });

  it("GivenEveryEntry_WhenItsRoutesAndToolsAreChecked_ThenEachExists", async () => {
    const { routes, tools } = await surface();
    expect([...named((e) => e.routes)].filter((r) => !routes.has(r)).sort()).toEqual([]);
    expect([...named((e) => e.tools)].filter((t) => !tools.has(t)).sort()).toEqual([]);
  });

  it("GivenAnEntryWithOnlyOneSide_WhenChecked_ThenItSaysWhy", () => {
    const silent = PARITY.filter(
      (e) => (e.routes.length === 0 || e.tools.length === 0) && !e.oneSide?.trim(),
    ).map((e) => e.action);
    expect(silent).toEqual([]);
    // An entry has at least one side, and a reason only where a side is missing.
    expect(PARITY.filter((e) => e.routes.length === 0 && e.tools.length === 0)).toEqual([]);
    expect(
      PARITY.filter((e) => e.oneSide && e.routes.length > 0 && e.tools.length > 0).map(
        (e) => e.action,
      ),
    ).toEqual([]);
  });

  it("GivenOpenGaps_WhenChecked_ThenEachNamesATicketAndWhatIsMissing", () => {
    const gaps = PARITY.filter((e) => e.pending);
    for (const e of gaps) {
      expect(e.pending!.ticket).toMatch(/^AI-\d+$/);
      expect(e.pending!.missing.trim()).not.toBe("");
    }
    // The gaps held open on purpose today; a ticket that closes one removes its mark here.
    expect(gaps.map((e) => e.pending!.ticket).sort()).toEqual(["AI-294", "AI-299"]);
  });

  it("GivenTheActions_WhenListed_ThenEachIsNamedOnce", () => {
    const actions = PARITY.map((e) => e.action);
    expect(actions.filter((a, i) => actions.indexOf(a) !== i)).toEqual([]);
  });
});
