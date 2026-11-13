import {
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type ProjectPlanProposal,
} from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { parseAllowList, type TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { hashToken, newToken } from "./mcp/tokens";

/** AI-108: project plans over REST and MCP, in-process. A seeded proposal stands in for the agent. */

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;
const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

const proposal: ProjectPlanProposal = {
  summary: "Skeleton first.",
  milestones: [
    {
      title: "Walking skeleton",
      goal: "Andy can open it.",
      doneWhen: ["URL loads"],
      slices: ["CI"],
    },
    { title: "Log a run", goal: "Andy logs a run.", doneWhen: ["Run listed"], slices: ["Form"] },
  ],
};

async function setup() {
  const tracker = new InMemoryWorkTracker();
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  await tracker.createProject({ name: "Trail log", key: "TRL" });
  const token = newToken();
  await grants.put(hashToken(token), {
    kind: "access",
    clientId: "https://claude.ai/oauth/mcp-client-metadata",
    email: "andy@example.com",
    uid: "andy",
    resource: RESOURCE,
    scope: "",
    redirectUri: null,
    codeChallenge: null,
    expiresAt: "2999-01-01T00:00:00.000Z",
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(RESOURCE), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (input, init) =>
        app.fetch(input instanceof Request ? input : new Request(input, init)),
    }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { isError: result.isError === true, data: result.structuredContent as any };
  };
  const rest = (path: string, body?: unknown, auth: string | null = "andy") =>
    app.request(path, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
    });
  const titles = async () => (await tracker.listTickets("trl")).map((t) => t.title);
  return { tracker, call, rest, titles };
}

describe("project plans", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenASeededProposal_WhenApprovedOverRest_ThenTheEpicsAreCreatedInOrder", async () => {
    const s = await setup();
    const proposed = await s.rest("/api/projects/trl/plan", proposal);
    expect(proposed.status).toBe(201);
    expect(await s.titles()).toEqual([]);
    const waiting = await (await s.rest("/api/project-plans/waiting")).json();
    expect(waiting).toMatchObject([{ key: "TRL", plan: { status: "proposed" } }]);

    const decided = await s.rest("/api/projects/trl/plan/decision", { decision: "approved" });
    expect(decided.status).toBe(200);
    expect(await decided.json()).toMatchObject({
      plan: { status: "approved", decidedBy: "user:andy" },
      epics: [{ type: "epic", title: "M1: Walking skeleton" }, { title: "M2: Log a run" }],
    });
    expect(await s.titles()).toEqual(["M1: Walking skeleton", "M2: Log a run"]);
    const again = await s.rest("/api/projects/trl/plan/decision", { decision: "approved" });
    expect(again.status).toBe(409);
  });

  it("GivenASeededProposal_WhenRejectedOverMcp_ThenNoTicketsAndTheReasonIsKept", async () => {
    const s = await setup();
    expect((await s.call("submit_project_plan", { project: "trl", plan: proposal })).isError).toBe(
      false,
    );
    const inbox = await s.call("list_needs_me");
    expect(inbox.data.projectPlans).toMatchObject([{ key: "TRL" }]);

    const res = await s.call("reject_project_plan", { project: "TRL", reason: "Too big." });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ plan: { status: "rejected", reason: "Too big." }, epics: [] });
    expect(await s.titles()).toEqual([]);
    expect((await s.tracker.getProject("trl"))?.projectPlan?.reason).toBe("Too big.");
  });

  it("GivenAProposalOverMcp_WhenApprovedOverMcp_ThenEpicsAndTheInboxEmpties", async () => {
    const s = await setup();
    await s.call("submit_project_plan", { project: "trl", plan: proposal });
    const res = await s.call("approve_project_plan", { project: "trl" });
    expect(res.isError).toBe(false);
    expect(await s.titles()).toEqual(["M1: Walking skeleton", "M2: Log a run"]);
    expect((await s.call("list_needs_me")).data.projectPlans).toEqual([]);
  });

  it("GivenAMalformedPlan_WhenSubmitted_Then400AndNothingStored", async () => {
    const s = await setup();
    const res = await s.rest("/api/projects/trl/plan", { ...proposal, milestones: [] });
    expect(res.status).toBe(400);
    expect((await s.tracker.getProject("trl"))?.projectPlan).toBeNull();
  });

  it("GivenARejectionWithoutAReason_WhenDecided_Then400", async () => {
    const s = await setup();
    await s.rest("/api/projects/trl/plan", proposal);
    expect((await s.rest("/api/projects/trl/plan/decision", { decision: "rejected" })).status).toBe(
      400,
    );
  });

  it("GivenNoSignIn_WhenSubmitting_Then401AndNothingStored", async () => {
    const s = await setup();
    expect((await s.rest("/api/projects/trl/plan", proposal, null)).status).toBe(401);
    expect((await s.tracker.getProject("trl"))?.projectPlan).toBeNull();
  });
});
