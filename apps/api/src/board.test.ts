import { InMemoryRunStore, InMemoryWorkTracker, type BoardTicket } from "@andy/contracts";
import { rankBetween } from "@andy/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

describe("board API (AI-28: Board v2)", () => {
  let app: ReturnType<typeof createApp>;
  let tracker: InMemoryWorkTracker;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    app = createApp({
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs: new InMemoryRunStore(),
    });
    await tracker.createProject({ name: "AI", key: "AI" });
  });

  const call = async (method: string, path: string, body?: unknown, token = "andy") => {
    const res = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as unknown };
  };

  it("GivenATicketWithAnOpenQuestion_WhenTheBoardIsRead_ThenItsCardCountsIt", async () => {
    const t = await tracker.createTicket("ai", { title: "Board" }, "andy");
    await tracker.askQuestion("ai", t.id, { text: "Which lane?" }, "andy");

    const { status, json } = await call("GET", "/api/projects/ai/board");

    expect(status).toBe(200);
    expect((json as BoardTicket[])[0]).toMatchObject({
      key: "AI-1",
      summary: { openQuestions: 1, run: null, pullRequest: null },
    });
  });

  it("GivenThreeTickets_WhenTheLastIsRankedFirst_ThenTheBoardKeepsTheNewOrder", async () => {
    const [a, , c] = [
      await tracker.createTicket("ai", { title: "A" }, "andy"),
      await tracker.createTicket("ai", { title: "B" }, "andy"),
      await tracker.createTicket("ai", { title: "C" }, "andy"),
    ];

    const patched = await call("PATCH", `/api/projects/ai/tickets/${c!.id}`, {
      rank: rankBetween(null, a!.rank),
    });

    expect(patched.status).toBe(200);
    const { json } = await call("GET", "/api/projects/ai/board");
    expect((json as BoardTicket[]).map((t) => t.title)).toEqual(["C", "A", "B"]);
  });

  it("GivenAnUnknownProject_WhenTheBoardIsRead_Then404", async () => {
    expect((await call("GET", "/api/projects/nope/board")).status).toBe(404);
  });

  it("GivenNoToken_WhenTheBoardIsRead_Then401", async () => {
    expect((await call("GET", "/api/projects/ai/board", undefined, "bad")).status).toBe(401);
  });
});
