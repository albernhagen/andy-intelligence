import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { ADR_DIR, ADR_HOLDS_PER_TICKET } from "@andy/domain";
import { sign } from "@octokit/webhooks-methods";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { TokenVerifier } from "../auth";
import { WEBHOOK_PATH } from "../github/webhooks";
import { ownerOnlyAccess, type ProjectAccess } from "../project-access";
import { ClientMetadataResolver } from "./client-metadata";
import { mcpCaller } from "./test-client";

/**
 * AI-384: MCP `reserve_adr_number` end to end: the endpoint, `AdrNumbers`, the counter build runs
 * use, and the PR webhook that releases a ticket's holds.
 */

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;
const REPO = "albernhagen/andy-intelligence";
const SECRET = "whs";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

async function setup(access: ProjectAccess = ownerOnlyAccess()) {
  const tracker = new InMemoryWorkTracker();
  const grants = new InMemoryOAuthGrantStore();
  const host = new InMemoryCodeHost([
    { fullName: REPO, defaultBranch: "main", private: false, url: `https://github.com/${REPO}` },
  ]);
  for (const f of ["0116-late.md", "0160-x.md"]) host.files.set(`${ADR_DIR}/${f}`, "x");
  const connections = new InMemoryCodeHostConnectionStore();
  await connections.save({
    appId: "1",
    slug: "andy-intelligence",
    clientId: "Iv1",
    owner: "albernhagen",
    privateKey: "PEM",
    webhookSecret: SECRET,
    connectedAt: "2026-11-03T00:00:00.000Z",
  });
  const app = createApp({
    projectAccess: access,
    verifier,
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    github: {
      publicUrl: PUBLIC_URL,
      connections,
      events: new InMemoryCodeEventLog(),
      codeHostFor: () => host,
    },
  });
  await tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: [REPO] });
  const ticket = await tracker.createTicket("ai", { title: "ADR", type: "feature" }, "andy");
  const call = await mcpCaller(app, grants, RESOURCE);
  const reserve = (key = ticket.key) => call("reserve_adr_number", { ticket: key });
  const prClosed = async (merged: boolean) => {
    const body = JSON.stringify({
      action: "closed",
      repository: { full_name: REPO, default_branch: "main" },
      pull_request: {
        number: 9,
        state: "closed",
        merged,
        draft: false,
        title: `${ticket.key}: ADR`,
        body: `https://ai.andybernhagen.com/p/ai/t/${ticket.key}`,
        head: { ref: "m5/adr", sha: "abc", repo: { full_name: REPO } },
        base: { ref: "main" },
        html_url: `https://github.com/${REPO}/pull/9`,
      },
    });
    return app.request(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": `d-${merged}`,
        "x-hub-signature-256": await sign(SECRET, body),
      },
      body,
    });
  };
  return { tracker, ticket, reserve, prClosed };
}

describe("reserve_adr_number (AI-384)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAdrFilesOnMain_WhenASessionReserves_ThenItGetsANumberNoBuildRunHas", async () => {
    const t = await setup();
    const res = await t.reserve();
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ ticket: t.ticket.key, number: 161, label: "ADR-0161" });
    // A build run's reservation, on the same counter, skips it.
    expect(await t.tracker.reserveAdrNumber("ai", 160)).toBe(162);
    expect((await t.reserve()).data.number).toBe(163);
  });

  it("GivenATicketAtItsCap_WhenItsPullRequestCloses_ThenTheSlotIsFreeAndNoNumberRepeats", async () => {
    const t = await setup();
    for (let i = 0; i < ADR_HOLDS_PER_TICKET; i++) await t.reserve();
    const refused = await t.reserve();
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(`already holds ${ADR_HOLDS_PER_TICKET} ADR numbers`);
    expect((await t.prClosed(false)).status).toBe(200);
    expect((await t.reserve()).data.number).toBe(161 + ADR_HOLDS_PER_TICKET);
  });

  it("GivenAHeldNumber_WhenItsPullRequestMerges_ThenItIsReleased", async () => {
    const t = await setup();
    await t.reserve();
    expect((await t.prClosed(true)).status).toBe(200);
    expect(await t.tracker.releaseAdrHolds("ai", t.ticket.key)).toEqual([]);
  });

  it("GivenACallerWithoutAccessToTheTicketsProject_WhenReserved_ThenNotFoundAndNothingIsHeld", async () => {
    const t = await setup({ canRead: async () => false });
    const res = await t.reserve();
    expect(res.isError).toBe(true);
    expect(res.text).toContain("not found");
    expect(await t.tracker.reserveAdrNumber("ai", 160)).toBe(161);
  });

  it("GivenAnUnknownTicket_WhenReserved_ThenAPlainError", async () => {
    const t = await setup();
    const res = await t.reserve("AI-999");
    expect(res.isError).toBe(true);
    expect(res.text).toContain("AI-999");
  });
});
