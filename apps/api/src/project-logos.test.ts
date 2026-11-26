import {
  InMemoryOAuthGrantStore,
  InMemoryProjectLogoStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { parseAllowList, type TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { hashToken, newToken } from "./mcp/tokens";
import { ProjectLogoService } from "./project-logos";
import { ownerOnlyAccess } from "./project-access";

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;
const NOW = new Date("2026-11-26T10:00:00.000Z");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString(
  "base64",
);

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

async function setup() {
  const tracker = new InMemoryWorkTracker();
  const logos = new InMemoryProjectLogoStore();
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    projectLogos: logos,
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const rest = (method: string, body?: object, project = "ai") =>
    app.request(`/api/projects/${project}/logo`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
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
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { isError: result.isError === true, text, data: result.structuredContent as any };
  };
  return { tracker, logos, rest, call };
}

describe("project logo routes", () => {
  it("GivenNoLogo_WhenRead_ThenNullAndTheProjectHasNoStamp", async () => {
    const ctx = await setup();
    const res = await ctx.rest("GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logo: null });
    expect((await ctx.tracker.getProject("ai"))?.logoUpdatedAt).toBeNull();
  });

  it("GivenAnSvgWithMetadata_WhenUploaded_ThenTheSanitizedFileIsStoredAndStamped", async () => {
    const ctx = await setup();
    const res = await ctx.rest("PUT", {
      format: "svg",
      data: SVG.replace("<path", "<metadata>x</metadata><path"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logo: { data: string; updatedAt: string } };
    expect(body.logo.data).toBe(SVG);
    expect((await ctx.logos.get("ai"))?.updatedBy).toBe("user:andy");
    expect((await ctx.tracker.getProject("ai"))?.logoUpdatedAt).toBe(body.logo.updatedAt);
    expect(await (await ctx.rest("GET")).json()).toEqual(body);
  });

  it("GivenAPng_WhenUploaded_ThenItIsStored", async () => {
    const ctx = await setup();
    const res = await ctx.rest("PUT", { format: "png", data: PNG });
    expect(res.status).toBe(200);
    expect((await ctx.logos.get("ai"))?.format).toBe("png");
  });

  it("GivenAnSvgWithAScript_WhenUploaded_Then422WithTheReasonAndNothingStored", async () => {
    const ctx = await setup();
    const res = await ctx.rest("PUT", {
      format: "svg",
      data: SVG.replace("<path", "<script>alert(1)</script><path"),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      details: ["the SVG has a <script> element, which is not allowed"],
    });
    expect(await ctx.logos.get("ai")).toBeNull();
    expect((await ctx.tracker.getProject("ai"))?.logoUpdatedAt).toBeNull();
  });

  it("GivenAnUnknownFormat_WhenUploaded_Then400", async () => {
    const ctx = await setup();
    expect((await ctx.rest("PUT", { format: "gif", data: "R0lG" })).status).toBe(400);
  });

  it("GivenAStoredLogo_WhenRemoved_ThenTheDefaultMarkIsBack", async () => {
    const ctx = await setup();
    await ctx.rest("PUT", { format: "svg", data: SVG });
    const res = await ctx.rest("DELETE");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logo: null });
    expect(await ctx.logos.get("ai")).toBeNull();
    expect((await ctx.tracker.getProject("ai"))?.logoUpdatedAt).toBeNull();
  });

  it("GivenAnUnknownProject_WhenUploaded_Then404", async () => {
    const ctx = await setup();
    expect((await ctx.rest("PUT", { format: "svg", data: SVG }, "nope")).status).toBe(404);
  });
});

describe("project logo MCP tools", () => {
  it("GivenAnSvg_WhenSetOverMcp_ThenItIsStoredAndReadBack", async () => {
    const ctx = await setup();
    const set = await ctx.call("set_project_logo", { project: "ai", format: "svg", data: SVG });
    expect(set.isError).toBe(false);
    expect(set.data).toMatchObject({ project: "AI", format: "svg", bytes: SVG.length });
    const got = await ctx.call("get_project_logo", { project: "AI" });
    expect(got.data).toMatchObject({ logo: { format: "svg", data: SVG } });
  });

  it("GivenAnExternalReference_WhenSetOverMcp_ThenRefusedWithTheReason", async () => {
    const ctx = await setup();
    const res = await ctx.call("set_project_logo", {
      project: "AI",
      format: "svg",
      data: SVG.replace('d="M0 0"', 'd="M0 0" fill="url(https://evil.example/g)"'),
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("external reference");
    expect(await ctx.logos.get("ai")).toBeNull();
  });

  it("GivenAStoredLogo_WhenRemovedOverMcp_ThenNull", async () => {
    const ctx = await setup();
    await ctx.call("set_project_logo", { project: "AI", format: "png", data: PNG });
    const res = await ctx.call("remove_project_logo", { project: "AI" });
    expect(res.data).toEqual({ project: "AI", logo: null });
    expect((await ctx.tracker.getProject("ai"))?.logoUpdatedAt).toBeNull();
  });
});

describe("ProjectLogoService", () => {
  it("GivenAnAgentActor_WhenSettingALogo_ThenForbidden", async () => {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    const service = new ProjectLogoService(tracker, new InMemoryProjectLogoStore(), () => NOW);
    await expect(
      service.set("ai", { format: "svg", data: SVG }, "agent:run-1"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("GivenTheClock_WhenStored_ThenTheStampIsTheClocksTime", async () => {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    const service = new ProjectLogoService(tracker, new InMemoryProjectLogoStore(), () => NOW);
    const view = await service.set("ai", { format: "svg", data: SVG }, "user:andy");
    expect(view.logo?.updatedAt).toBe(NOW.toISOString());
    expect((await tracker.getProject("ai"))?.logoUpdatedAt).toBe(NOW.toISOString());
  });
});
