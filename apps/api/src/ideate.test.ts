import { InMemoryOAuthGrantStore } from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_URL, REPO, createdApp, githubApp } from "./github/test-app";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { hashToken, newToken } from "./mcp/tokens";

/** AI-114: `POST /api/projects/{id}/ideate` end to end in-process, with the code host fake. */

const epicResult = {
  summary: "Weekly summary.",
  outcome: "epic",
  epic: {
    title: "Andy sees his week",
    body: "Runs pile up.",
    acceptanceCriteria: ["WHEN Andy opens the week THE SYSTEM SHALL show totals"],
    slices: [{ title: "Totals", summary: "Sum the week." }],
  },
  spec: { path: "specs/weekly-summary.md", markdown: "## Problem\n" },
  questions: [],
};
const questionResult = {
  summary: "Contradicts a non-goal.",
  outcome: "question",
  epic: null,
  spec: null,
  questions: [
    {
      question:
        "This adds team accounts, but the brief rules out multi-user: update the brief or change the idea?",
      context: "Team accounts let friends log runs. The brief says Andy only.",
      options: [
        { label: "Update the brief", consequence: "The epic goes ahead." },
        { label: "Drop it", consequence: "Nothing is built." },
      ],
      recommendation: { answer: "Drop it", reason: "Andy only." },
    },
  ],
};

async function setup() {
  const grants = new InMemoryOAuthGrantStore();
  const t = githubApp(
    {},
    { mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() } },
  );
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const ideate = (result: unknown) =>
    t.call("/api/projects/ai/ideate", {
      method: "POST",
      body: JSON.stringify({ idea: "A weekly summary", result }),
    });
  const mcp = async () => {
    const token = newToken();
    await grants.put(hashToken(token), {
      kind: "access",
      clientId: "https://claude.ai/oauth/mcp-client-metadata",
      email: "andy@example.com",
      uid: "andy",
      resource: `${PUBLIC_URL}/mcp`,
      scope: "",
      redirectUri: null,
      codeChallenge: null,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    const client = new Client({ name: "test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${PUBLIC_URL}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
        fetch: async (input, init) =>
          t.app.fetch(input instanceof Request ? input : new Request(input, init)),
      }),
    );
    return client;
  };
  return { ...t, ideate, mcp };
}

describe("POST /api/projects/{projectId}/ideate", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAnEpicResult_WhenAndySubmits_Then201AnEpicInIdeasAndASpecPr", async () => {
    const s = await setup();
    const res = await s.ideate(epicResult);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      outcome: "epic",
      epic: { key: "AI-1", type: "epic", upNextRank: null },
      specPullRequest: { number: 1000 },
    });
    expect(s.host.proposals[0]!.proposal.path).toBe("specs/weekly-summary.md");
  });

  it("GivenAQuestionResult_WhenSubmitted_ThenTheQuestionIsInNeedsYouAndNoEpic", async () => {
    const s = await setup();
    expect((await s.ideate(questionResult)).status).toBe(201);
    const inbox = (await (await s.call("/api/needs-you")).json()) as {
      questions: { text: string }[];
    };
    expect(inbox.questions.map((q) => q.text)).toEqual([questionResult.questions[0]!.question]);
    expect((await s.tracker.listTickets("ai")).some((t) => t.type === "epic")).toBe(false);
    expect(s.host.proposals).toEqual([]);
  });

  it("GivenAResultWhoseFieldsDontFitItsOutcome_WhenSubmitted_Then400AndNothingCreated", async () => {
    const s = await setup();
    expect((await s.ideate({ ...epicResult, questions: questionResult.questions })).status).toBe(
      400,
    );
    expect(await s.tracker.listTickets("ai")).toEqual([]);
  });

  it("GivenNoSignIn_WhenSubmitted_Then401AndNothingCreated", async () => {
    const s = await setup();
    const res = await s.call(
      "/api/projects/ai/ideate",
      { method: "POST", body: JSON.stringify({ idea: "x", result: epicResult }) },
      null,
    );
    expect(res.status).toBe(401);
    expect(await s.tracker.listTickets("ai")).toEqual([]);
  });

  it("GivenClaudeDesktop_WhenItCallsIdeateWithAnEpicResult_ThenTheEpicAndSpecPrExist", async () => {
    const s = await setup();
    const client = await s.mcp();
    const res = await client.callTool({
      name: "ideate",
      arguments: { project: "ai", idea: "A weekly summary", result: epicResult },
    });
    expect(res.isError).not.toBe(true);
    expect(res.structuredContent).toMatchObject({ outcome: "epic", epic: { key: "AI-1" } });
    expect(s.host.proposals).toHaveLength(1);
  });
});
