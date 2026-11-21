import { InMemoryRunStore, InMemoryWorkTracker, type Ticket } from "@andy/contracts";
import { TicketService } from "@andy/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import type { ToolDeps } from "./mcp/tools";
import { registerTicketTools } from "./mcp/tools-tickets";
import { ownerOnlyAccess } from "./project-access";

/** AI-186: M4.24: Epic outcome field through the ticket PATCH route and MCP `edit_ticket`. */

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

describe("epic outcome API", () => {
  let tracker: InMemoryWorkTracker;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    tracker = new InMemoryWorkTracker();
    app = createApp({
      projectAccess: ownerOnlyAccess(),
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs: new InMemoryRunStore(),
    });
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  async function ticket(type: "epic" | "feature") {
    await call("POST", "/api/projects", { name: "AI", key: "AI" });
    return (await call("POST", "/api/projects/ai/tickets", { type, title: "Roadmap" }))
      .json as unknown as Ticket;
  }

  it("GivenAnEpic_WhenItsOutcomeIsPatched_ThenItIsSavedAndReadBack", async () => {
    const epic = await ticket("epic");
    const patched = await call("PATCH", `/api/projects/ai/tickets/${epic.id}`, {
      outcome: "Andy sees every milestone.",
    });
    expect(patched.status).toBe(200);
    const read = await call("GET", `/api/tickets/${epic.key}`);
    expect(read.json.outcome).toBe("Andy sees every milestone.");
  });

  it("GivenAFeature_WhenAnOutcomeIsPatched_ThenItIsRefusedWithAReason", async () => {
    const feature = await ticket("feature");
    const res = await call("PATCH", `/api/projects/ai/tickets/${feature.id}`, { outcome: "Done" });
    expect(res.status).toBe(422);
    expect(String(res.json.error)).toMatch(/only an epic has an outcome/);
  });

  it("GivenAnOutcomeOver300Characters_WhenPatched_ThenItIsRefused", async () => {
    const epic = await ticket("epic");
    const res = await call("PATCH", `/api/projects/ai/tickets/${epic.id}`, {
      outcome: "x".repeat(301),
    });
    expect(res.status).toBe(400);
    expect((await tracker.getTicket("ai", epic.id))?.outcome).toBeNull();
  });

  it("GivenMcpEditTicket_WhenAnOutcomeIsSet_ThenEpicsAcceptItAndOthersAreRefused", async () => {
    const service = new TicketService(tracker);
    await tracker.createProject({ name: "AI", key: "AI" });
    const epic = await service.create("ai", { type: "epic", title: "Roadmap" }, "andy");
    const bug = await service.create("ai", { type: "bug", title: "Typo" }, "andy");
    const server = new McpServer({ name: "test", version: "1" });
    registerTicketTools(server, {
      tracker,
      service,
      actor: "andy",
      email: "",
    } as unknown as ToolDeps);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    const edit = (args: Record<string, unknown>) =>
      client.callTool({ name: "edit_ticket", arguments: args });

    expect((await edit({ ticket: epic.key, outcome: "Shipped" })).isError).not.toBe(true);
    expect((await tracker.getTicket("ai", epic.id))?.outcome).toBe("Shipped");
    const refused = await edit({ ticket: bug.key, outcome: "Shipped" });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toMatch(/only an epic has an outcome/);
  });
});
