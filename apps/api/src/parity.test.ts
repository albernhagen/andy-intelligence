import { describe, expect, it } from "vitest";
import { mcpToolNames } from "./mcp/test-client";
import { PARITY, type ParityEntry, WEB_ONLY_ALLOWED, webOnlyViolations } from "./parity";
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
    expect(gaps.map((e) => e.pending!.ticket).sort()).toEqual([]);
  });

  it("GivenRunnerRevocation_WhenChecked_ThenCoveredByRevokeRunner", () => {
    const revoke = PARITY.find((e) => e.routes.includes("POST /api/runners/:runnerId/revoke"));
    expect(revoke).toMatchObject({ tools: ["revoke_runner"] });
    expect(revoke?.pending).toBeUndefined();
    expect(revoke?.oneSide).toBeUndefined();
  });

  it("GivenTheActions_WhenListed_ThenEachIsNamedOnce", () => {
    const actions = PARITY.map((e) => e.action);
    expect(actions.filter((a, i) => actions.indexOf(a) !== i)).toEqual([]);
  });
});

describe("Web-only actions: settings only (ADR-0148)", () => {
  const webOnly = (action: string, route: string): ParityEntry => ({
    action,
    routes: [route],
    tools: [],
    oneSide: "New for this test.",
  });

  it("GivenTheRegistry_WhenWebOnlyActionsAreChecked_ThenNoneBreaksTheRule", () => {
    expect(webOnlyViolations(PARITY)).toEqual([]);
  });

  it("GivenTheAllowList_WhenComparedToTheRegistry_ThenEachNameIsAWebOnlyAction", () => {
    const webOnlyActions = new Set(
      PARITY.filter((e) => e.routes.length > 0 && e.tools.length === 0).map((e) => e.action),
    );
    expect([...WEB_ONLY_ALLOWED].filter((a) => !webOnlyActions.has(a))).toEqual([]);
  });

  it("GivenANewWebOnlySettingsActionOnTheAllowList_WhenChecked_ThenItPasses", () => {
    const entry = webOnly("Set the board's colour theme", "PUT /api/projects/:projectId/theme");
    const allowed = new Set([...WEB_ONLY_ALLOWED, entry.action]);
    expect(webOnlyViolations([...PARITY, entry], allowed)).toEqual([]);
  });

  it("GivenANewWebOnlySettingsActionOffTheAllowList_WhenChecked_ThenItFails", () => {
    const entry = webOnly("Set the board's colour theme", "PUT /api/projects/:projectId/theme");
    expect(webOnlyViolations([...PARITY, entry])).toEqual([
      "Set the board's colour theme: web only but not on WEB_ONLY_ALLOWED",
    ]);
  });

  it.each([
    ["ticket", "POST /api/projects/:projectId/tickets/:ticketId/pin"],
    ["question", "POST /api/questions/:questionId/snooze"],
    ["plan", "POST /api/projects/:projectId/plan/archive"],
    ["milestone", "POST /api/projects/:projectId/milestones/:milestoneId/close"],
    ["run", "POST /api/projects/:projectId/tickets/:ticketId/runs/:runId/retry"],
  ])(
    "GivenANewWebOnly%sActionWithNoMcpTool_WhenChecked_ThenItFailsEvenOnTheAllowList",
    (kind, route) => {
      const entry = webOnly(`New ${kind} action`, route);
      const allowed = new Set([...WEB_ONLY_ALLOWED, entry.action]);
      expect(webOnlyViolations([...PARITY, entry], allowed)).toEqual([
        `New ${kind} action: needs an MCP tool (${route})`,
      ]);
    },
  );

  it("GivenANewWebOnlyTicketActionMarkedPending_WhenChecked_ThenItStillFails", () => {
    const route = "POST /api/projects/:projectId/tickets/:ticketId/pin";
    const entry: ParityEntry = {
      ...webOnly("Pin a ticket", route),
      pending: { ticket: "AI-1", missing: "pin_ticket" },
    };
    expect(webOnlyViolations([...PARITY, entry])).toEqual([
      "Pin a ticket: web only but not on WEB_ONLY_ALLOWED",
      `Pin a ticket: needs an MCP tool (${route})`,
    ]);
  });

  it("GivenANewTicketActionWithBothSides_WhenChecked_ThenItPasses", () => {
    const entry: ParityEntry = {
      action: "Pin a ticket",
      routes: ["POST /api/projects/:projectId/tickets/:ticketId/pin"],
      tools: ["pin_ticket"],
    };
    expect(webOnlyViolations([...PARITY, entry])).toEqual([]);
  });
});
