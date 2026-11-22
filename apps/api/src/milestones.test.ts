import {
  InMemoryConfigChangeStore,
  InMemoryMilestoneStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";

/** AI-304: M4.34: milestone routes and MCP tools share one service: same data, same refusals. */

const PUBLIC_URL = "http://localhost";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "andy") return { uid: "uid-1", email: "andy@example.com", emailVerified: true };
    throw new Error("bad token");
  },
};

async function setup() {
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ name: "AI", key: "AI" });
  await tracker.createProject({ name: "Ops", key: "OPS" });
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    verifier,
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    configChanges: new InMemoryConfigChangeStore(),
    milestones: new InMemoryMilestoneStore(),
    projectAccess: ownerOnlyAccess(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  const rest = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const mcp = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
  const epic = (title = "Roadmap", parentId: string | null = null) =>
    tracker.createTicket("ai", { title, type: "epic", parentId }, "andy");
  return { tracker, rest, mcp, epic };
}

describe("milestones over REST and MCP (AI-304 parity)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenMilestones_WhenListedOverRestAndMcp_ThenTheSameList", async () => {
    const { rest, mcp } = await setup();
    expect(
      (await rest("POST", "/api/projects/ai/milestones", { name: "M4", outcome: "Epics" })).status,
    ).toBe(201);
    await rest("POST", "/api/projects/ai/milestones", { name: "M5", outcome: "Projects" });
    const viaRest = await rest("GET", "/api/projects/ai/milestones");
    const viaMcp = await mcp("list_milestones", { project: "ai" });
    expect(viaMcp.isError).toBe(false);
    expect(viaMcp.data.milestones).toEqual(viaRest.json);
    expect(viaRest.json.map((m: { name: string }) => m.name)).toEqual(["M4", "M5"]);
  });

  it("GivenCreateOverEach_WhenListed_ThenBothAreThereNotReviewedAndLogged", async () => {
    const { rest, mcp } = await setup();
    const viaRest = await rest("POST", "/api/projects/ai/milestones", { name: "M4", outcome: "x" });
    const viaMcp = await mcp("create_milestone", { project: "AI", name: "M5", outcome: "y" });
    expect(viaMcp.isError).toBe(false);
    expect(viaMcp.data).toMatchObject({ name: "M5", order: 1, status: "not_reviewed" });
    expect(viaRest.json).toMatchObject({ name: "M4", order: 0, status: "not_reviewed" });
    const list = (await rest("GET", "/api/projects/ai/milestones")).json;
    expect(list.map((m: { name: string }) => m.name)).toEqual(["M4", "M5"]);
    const created = (await rest("GET", "/api/projects/ai/config-changes")).json.filter(
      (c: { entity: string; diff: object }) => c.entity === "milestone" && "created" in c.diff,
    );
    expect(created).toHaveLength(2);
  });

  it("GivenBadInput_WhenCreatedOverEach_ThenBothRefuse", async () => {
    const { rest, mcp } = await setup();
    const long = "x".repeat(301);
    expect(
      (await rest("POST", "/api/projects/ai/milestones", { name: "M4", outcome: long })).status,
    ).toBe(400);
    expect(
      (await mcp("create_milestone", { project: "AI", name: "M4", outcome: long })).isError,
    ).toBe(true);
    expect((await rest("GET", "/api/projects/ai/milestones")).json).toEqual([]);
  });

  it("GivenAnEmptyEdit_WhenSentOverEach_ThenTheMilestoneIsUnchangedAndNothingIsLogged", async () => {
    const { rest, mcp } = await setup();
    const m = (await rest("POST", "/api/projects/ai/milestones", { name: "M4", outcome: "x" }))
      .json;
    const viaRest = await rest("PATCH", `/api/projects/ai/milestones/${m.id}`, {});
    const viaMcp = await mcp("edit_milestone", { project: "AI", milestone: m.id });
    expect(viaRest.status).toBe(200);
    expect(viaMcp.isError).toBe(false);
    expect(viaMcp.data).toEqual(viaRest.json);
    expect(viaRest.json).toEqual(m);
    const logged = (await rest("GET", "/api/projects/ai/config-changes")).json.filter(
      (c: { entity: string }) => c.entity === "milestone",
    );
    expect(logged).toHaveLength(1);
  });

  it("GivenAMilestone_WhenEditedOverEach_ThenTheSameFieldsChangeAndARevertUndoesIt", async () => {
    const { rest, mcp } = await setup();
    const m = (await rest("POST", "/api/projects/ai/milestones", { name: "M4", outcome: "x" }))
      .json;
    const viaRest = await rest("PATCH", `/api/projects/ai/milestones/${m.id}`, { name: "M4a" });
    expect(viaRest.json.name).toBe("M4a");
    const viaMcp = await mcp("edit_milestone", {
      project: "AI",
      milestone: m.id,
      outcome: "Epics on a roadmap",
      order: 3,
    });
    expect(viaMcp.data).toMatchObject({ name: "M4a", outcome: "Epics on a roadmap", order: 3 });
    const change = (await rest("GET", "/api/projects/ai/config-changes")).json.find(
      (c: { entity: string; diff: object }) => c.entity === "milestone" && "outcome" in c.diff,
    );
    expect((await mcp("revert_settings_change", { project: "AI", id: change.id })).isError).toBe(
      false,
    );
    const after = (await rest("GET", "/api/projects/ai/milestones")).json[0];
    expect(after).toMatchObject({ outcome: "x", order: 0 });
    const unknown = await mcp("edit_milestone", { project: "AI", milestone: "nope", name: "Z" });
    const unknownRest = await rest("PATCH", "/api/projects/ai/milestones/nope", { name: "Z" });
    expect(unknownRest.status).toBe(404);
    expect(unknown.text).toBe(unknownRest.json.error);
  });

  it("GivenThreeMilestones_WhenTheLastIsMovedUpOverEach_ThenBothListTheSameOrder", async () => {
    // AI-324: the roadmap's reorder is a PATCH of `order`; MCP does the same with edit_milestone.
    const names = async (s: Awaited<ReturnType<typeof setup>>) =>
      (await s.rest("GET", "/api/projects/ai/milestones")).json.map(
        (m: { name: string }) => m.name,
      );
    const viaRest = await setup();
    const viaMcp = await setup();
    for (const s of [viaRest, viaMcp]) {
      for (const [name, order] of [
        ["M1", 0],
        ["M2", 10],
        ["M3", 20],
      ] as const) {
        await s.rest("POST", "/api/projects/ai/milestones", { name, outcome: "x", order });
      }
    }
    const last = async (s: typeof viaRest) =>
      (await s.rest("GET", "/api/projects/ai/milestones")).json[2].id as string;

    const saved = await viaRest.rest(
      "PATCH",
      `/api/projects/ai/milestones/${await last(viaRest)}`,
      {
        order: 5,
        reason: "Reordered on the roadmap",
      },
    );
    const moved = await viaMcp.mcp("edit_milestone", {
      project: "AI",
      milestone: await last(viaMcp),
      order: 5,
    });

    expect(saved.status).toBe(200);
    expect(moved.isError).toBe(false);
    expect(await names(viaRest)).toEqual(["M1", "M3", "M2"]);
    expect(await names(viaMcp)).toEqual(["M1", "M3", "M2"]);
  });

  it("GivenAMilestone_WhenItsStatusIsSetOverEach_ThenBothSaveAndTheChangeLogShowsThem", async () => {
    const { rest, mcp } = await setup();
    const m = (await rest("POST", "/api/projects/ai/milestones", { name: "M4", outcome: "x" }))
      .json;
    const viaRest = await rest("PATCH", `/api/projects/ai/milestones/${m.id}`, {
      status: "approved",
    });
    expect(viaRest.json.status).toBe("approved");
    const viaMcp = await mcp("set_milestone_status", {
      project: "AI",
      milestone: m.id,
      status: "parked",
    });
    expect(viaMcp.data.status).toBe("parked");
    const log = await rest("GET", "/api/projects/ai/config-changes");
    const statuses = log.json
      .filter((c: { entity: string }) => c.entity === "milestone")
      .map((c: { diff: { status?: { to: string } } }) => c.diff.status?.to)
      .filter(Boolean);
    expect(statuses).toEqual(["parked", "approved"]);
  });

  it("GivenATopLevelEpic_WhenAttachedOverEach_ThenTheSameTicketAndDetachWorks", async () => {
    const { rest, mcp, epic, tracker } = await setup();
    const m = (await rest("POST", "/api/projects/ai/milestones", { name: "M4", outcome: "x" }))
      .json;
    const a = await epic("A");
    const b = await epic("B");
    const viaRest = await rest("PUT", `/api/projects/ai/tickets/${a.id}/milestone`, {
      milestoneId: m.id,
    });
    expect(viaRest.json.milestoneId).toBe(m.id);
    const viaMcp = await mcp("set_epic_milestone", { project: "AI", epic: b.key, milestone: m.id });
    expect(viaMcp.data.milestoneId).toBe(m.id);
    await mcp("set_epic_milestone", { project: "AI", epic: b.key, milestone: null });
    expect((await tracker.getTicket("ai", b.id))?.milestoneId).toBeNull();
  });

  it("GivenAFeatureOrAChildEpic_WhenAttached_ThenBothRefuseWithTheSameReason", async () => {
    const { rest, mcp, epic, tracker } = await setup();
    const m = (await rest("POST", "/api/projects/ai/milestones", { name: "M4", outcome: "x" }))
      .json;
    const feature = await tracker.createTicket("ai", { title: "Chips", type: "feature" }, "andy");
    const parent = await epic();
    const child = await epic("Child", parent.id);
    for (const t of [feature, child]) {
      const viaRest = await rest("PUT", `/api/projects/ai/tickets/${t.id}/milestone`, {
        milestoneId: m.id,
      });
      const viaMcp = await mcp("set_epic_milestone", {
        project: "AI",
        epic: t.key,
        milestone: m.id,
      });
      expect(viaRest.status).toBe(422);
      expect(viaMcp.isError).toBe(true);
      expect(viaMcp.text).toBe(viaRest.json.error);
    }
  });

  it("GivenAnotherProjectsMilestoneOrAnUnknownProject_WhenUsed_ThenBothRefuseAsNotFound", async () => {
    const { rest, mcp, epic } = await setup();
    const theirs = (
      await rest("POST", "/api/projects/ops/milestones", { name: "Ops", outcome: "x" })
    ).json;
    const e = await epic();
    const viaRest = await rest("PUT", `/api/projects/ai/tickets/${e.id}/milestone`, {
      milestoneId: theirs.id,
    });
    const viaMcp = await mcp("set_epic_milestone", {
      project: "AI",
      epic: e.key,
      milestone: theirs.id,
    });
    expect(viaRest.status).toBe(404);
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toBe(viaRest.json.error);
    expect((await rest("GET", "/api/projects/nope/milestones")).status).toBe(404);
    expect((await mcp("list_milestones", { project: "NOPE" })).isError).toBe(true);
  });

  it("GivenALoggedStatusChange_WhenRevertedFromTheChangeLog_ThenThePreviousStatusIsBack", async () => {
    const { rest, mcp } = await setup();
    const m = (await rest("POST", "/api/projects/ai/milestones", { name: "M4", outcome: "x" }))
      .json;
    await rest("PATCH", `/api/projects/ai/milestones/${m.id}`, { status: "approved" });
    const change = (await rest("GET", "/api/projects/ai/config-changes")).json.find(
      (c: { entity: string; diff: object }) => c.entity === "milestone" && "status" in c.diff,
    );
    const reverted = await mcp("revert_settings_change", { project: "AI", id: change.id });
    expect(reverted.isError).toBe(false);
    const list = (await rest("GET", "/api/projects/ai/milestones")).json;
    expect(list[0].status).toBe("not_reviewed");
  });

  it("GivenATicketPatch_WhenItCarriesAMilestone_ThenTheMilestoneIsNotSetThatWay", async () => {
    const { rest, epic, tracker } = await setup();
    const m = (await rest("POST", "/api/projects/ai/milestones", { name: "M4", outcome: "x" }))
      .json;
    const e = await epic();
    await rest("PATCH", `/api/projects/ai/tickets/${e.id}`, {
      milestoneId: m.id,
      title: "Renamed",
    });
    const after = await tracker.getTicket("ai", e.id);
    expect(after?.milestoneId).toBeNull();
  });
});
