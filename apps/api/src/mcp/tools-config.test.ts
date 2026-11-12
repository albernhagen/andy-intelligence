import {
  InMemoryConfigChangeStore,
  InMemoryOAuthGrantStore,
  InMemoryReviewFindingSource,
  ReviewFinding,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ClientMetadataResolver } from "./client-metadata";
import { hashToken, newToken } from "./tokens";

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

async function setup() {
  const tracker = new InMemoryWorkTracker();
  const findings = new InMemoryReviewFindingSource();
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    configChanges: new InMemoryConfigChangeStore(),
    reviewFindings: findings,
  });
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
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { isError: result.isError === true, text, data: result.structuredContent as any };
  };
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  return { call, findings };
}

const finding = (pullNumber: number): ReviewFinding =>
  ReviewFinding.parse({
    projectId: "ai",
    repo: "albernhagen/andy-intelligence",
    pullNumber,
    reviewer: "adversarial",
    severity: "should-fix",
    kind: "missing-test",
    title: "No test for the error path",
    file: null,
    headSha: "abc1234",
    recordedAt: `2026-11-12T10:0${pullNumber}:00.000Z`,
  });

/** ADR-0097 (AI-100): the config tools use the same ConfigProposals rules as REST and the UI. */
describe("config change tools", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenRepeatedFindings_WhenSweptListedAndAccepted_ThenAcceptedAndNotApplied", async () => {
    const ctx = await setup();
    ctx.findings.add(finding(1), finding(2), finding(3));

    const sweep = await ctx.call("sweep_config_proposals", { project: "ai" });
    const listed = await ctx.call("list_config_changes", { project: "AI" });
    const id = listed.data.changes[0].id;
    const accepted = await ctx.call("accept_config_change", { id });
    const again = await ctx.call("reject_config_change", { id });

    expect(sweep.data.created).toHaveLength(1);
    expect(listed.data.changes).toMatchObject([{ status: "pending", entityId: "AGENTS.md" }]);
    expect(accepted.data).toMatchObject({
      status: "accepted",
      appliedAt: null,
      decidedBy: "user:andy",
    });
    expect(again.isError).toBe(true);
    expect((await ctx.call("list_config_changes")).data.changes).toEqual([]);
  });

  it("GivenAPendingChange_WhenRejected_ThenRejected", async () => {
    const ctx = await setup();
    ctx.findings.add(finding(1), finding(2), finding(3));
    const { data } = await ctx.call("sweep_config_proposals", { project: "ai" });

    const rejected = await ctx.call("reject_config_change", { id: data.created[0] });

    expect(rejected.data).toMatchObject({ status: "rejected", decidedBy: "user:andy" });
  });
});
