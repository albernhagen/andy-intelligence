import { InMemoryOAuthGrantStore, InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { DEFAULT_ROUTE } from "@andy/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { parseAllowList, type TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";

/**
 * AI-293: Parity: a ticket's full history and agent tasks over MCP. `ticket_history`,
 * `list_runs` and `get_run` return what their routes return; pages join up to the route's list.
 */

const PUBLIC_URL = "https://control-plane.example.run.app";
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "andy") return { uid: "andy", email: "andy@example.com", emailVerified: true };
    throw new Error("bad token");
  },
};

async function setup() {
  const tracker = new InMemoryWorkTracker();
  const runs = new InMemoryRunStore();
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await tracker.createProject({ name: "Ops", key: "OPS" });
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs,
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  const get = async (path: string) => {
    const res = await app.request(path, { headers: { authorization: "Bearer andy" } });
    return { status: res.status, body: (await res.json()) as unknown };
  };
  const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);

  const ticket = await tracker.createTicket("ai", { type: "chore", title: "History" }, "andy");
  for (let i = 1; i <= 6; i++) await tracker.addComment("ai", ticket.id, `note ${i}`, "andy");
  const task = (projectId: string, ticketId: string, step: "refine" | "build") =>
    runs.create({
      projectId,
      ticketId,
      step,
      route: DEFAULT_ROUTE,
      tier: null,
      deadline: null,
      prompt: "go",
      maxTurns: 10,
    });
  const refine = await task("ai", ticket.id, "refine");
  await task("ai", ticket.id, "build");
  await task("ai", ticket.id, "build");
  const other = await tracker.createTicket("ops", { type: "chore", title: "Backups" }, "andy");
  const opsTask = await task("ops", other.id, "refine");
  return { get, call, ticket, refine, opsTask };
}

/** Every page of `tool`, read in order through nextOffset, joined. */
async function allPages(
  call: Awaited<ReturnType<typeof setup>>["call"],
  tool: string,
  field: "events" | "runs",
  args: Record<string, unknown>,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let offset: number | null = 0;
  for (let i = 0; offset !== null && i < 20; i++) {
    const page = (await call(tool, { ...args, offset, limit: 2 })).data as {
      nextOffset: number | null;
    } & Record<string, unknown[]>;
    items.push(...page[field]!);
    offset = page.nextOffset;
  }
  return items;
}

describe("ticket history and agent tasks parity (AI-293)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenATicketWithHistory_WhenPagedOverMcp_ThenThePagesAreExactlyTheRoutesList", async () => {
    const { get, call, ticket } = await setup();
    const rest = await get(`/api/projects/ai/tickets/${ticket.id}/events`);
    expect(rest.status).toBe(200);
    expect((rest.body as unknown[]).length).toBe(7);
    expect(await allPages(call, "ticket_history", "events", { ticket: ticket.key })).toEqual(
      rest.body,
    );
    const first = (await call("ticket_history", { ticket: ticket.key })).data;
    expect(first).toMatchObject({ ticket: ticket.key, total: 7, offset: 0, nextOffset: null });
  });

  it("GivenATicketsAgentTasks_WhenListedAndReadOverMcp_ThenTheyMatchTheRoutes", async () => {
    const { get, call, ticket, refine } = await setup();
    const rest = await get(`/api/projects/ai/tickets/${ticket.id}/runs`);
    expect(await allPages(call, "list_runs", "runs", { ticket: ticket.key })).toEqual(rest.body);

    const one = await get(`/api/projects/ai/runs/${refine.id}`);
    expect(one.status).toBe(200);
    expect((await call("get_run", { project: "AI", runId: refine.id })).data).toEqual(one.body);
  });

  it("GivenAnUnknownTicketOrAnotherProjectsTask_WhenRead_ThenBothSidesRefuse", async () => {
    const { get, call, opsTask } = await setup();
    const missing = await call("ticket_history", { ticket: "AI-999" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("not found");
    expect((await call("list_runs", { ticket: "AI-999" })).isError).toBe(true);

    expect((await get(`/api/projects/ai/runs/${opsTask.id}`)).status).toBe(404);
    const cross = await call("get_run", { project: "AI", runId: opsTask.id });
    expect(cross.isError).toBe(true);
    expect(cross.text).toContain("not found");

    expect((await get("/api/projects/ai/runs/bad_id!")).status).toBe(400);
    expect((await call("get_run", { project: "AI", runId: "bad_id!" })).isError).toBe(true);
  });

  it("GivenALimitPastTheCap_WhenCalled_ThenTheToolRefusesIt", async () => {
    const { call, ticket } = await setup();
    expect((await call("ticket_history", { ticket: ticket.key, limit: 201 })).isError).toBe(true);
  });
});
