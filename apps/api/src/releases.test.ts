import {
  InMemoryDeploymentStore,
  InMemoryOAuthGrantStore,
  InMemoryReleaseNoteStore,
  type ReleaseListing,
} from "@andy/contracts";
import { buildReleaseNote } from "@andy/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, githubApp } from "./github/test-app";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import type { ProjectAccess } from "./project-access";

/** AI-183: M6.9: the releases route and `list_releases` read the same listing. */

const MCP_URL = "https://cp.example/mcp";
const sha = (c: string) => c.repeat(40);
const DIGEST = `sha256:${"e".repeat(64)}`;

describe("Releases API and MCP (AI-183: M6.9)", () => {
  let t: ReturnType<typeof githubApp>;
  let deployments: InMemoryDeploymentStore;
  let notes: InMemoryReleaseNoteStore;
  let grants: InMemoryOAuthGrantStore;
  let storyKey: string;

  const deploy = async (
    gitSha: string,
    startedAt: string,
    environment: "prod" | "dev" = "prod",
  ) => {
    const d = await deployments.record({
      projectId: "ai",
      environment,
      imageDigest: DIGEST,
      gitSha,
      kind: "deploy",
      status: "started",
      startedAt,
      actor: "system",
    });
    return deployments.finish(d.id, { status: "succeeded", finishedAt: startedAt });
  };

  const setup = async (projectAccess?: ProjectAccess) => {
    deployments = new InMemoryDeploymentStore();
    notes = new InMemoryReleaseNoteStore();
    grants = new InMemoryOAuthGrantStore();
    t = githubApp(
      {},
      {
        deployments,
        releaseNotes: notes,
        mcp: { publicUrl: "https://cp.example", grants, clients: new ClientMetadataResolver() },
        ...(projectAccess ? { projectAccess } : {}),
      },
    );
    await t.connections.save({
      appId: "1",
      slug: "andy-intelligence",
      clientId: "Iv1",
      owner: "albernhagen",
      privateKey: "PEM",
      webhookSecret: "whs",
      connectedAt: "2026-11-03T00:00:00.000Z",
    });
    const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
    const story = await t.tracker.createTicket(
      project.id,
      { type: "feature", title: "Releases API" },
      "andy",
    );
    storyKey = story.key;
    await notes.put(
      buildReleaseNote({
        projectId: "ai",
        pr: { number: 7, url: `https://github.com/${REPO}/pull/7`, title: "Releases API" },
        details: {
          body: "What changed: Andy can list releases.\nHow it works: A route.",
          mergedBy: null,
          mergedAt: "2026-11-20T10:30:00.000Z",
        },
        ticket: { key: story.key, title: story.title, risk: null },
        files: [],
        recordedAt: "2026-11-20T10:30:00.000Z",
      }),
    );
    await deploy(sha("a"), "2026-11-20T10:00:00.000Z");
    await deploy(sha("b"), "2026-11-20T12:00:00.000Z");
    t.host.commitRanges.set(`${sha("a")}...${sha("b")}`, {
      status: "ahead",
      commits: { items: [{ sha: sha("c"), title: "Releases API (#7)" }], complete: true },
    });
  };

  beforeEach(async () => {
    await setup();
  });

  it("GivenTwoProdDeployments_WhenListedOverTheApi_ThenNewestFirstWithTicketsAndNotes", async () => {
    const res = await t.call("/api/projects/ai/releases");
    expect(res.status).toBe(200);
    const listing = (await res.json()) as ReleaseListing;
    expect(listing.environment).toBe("prod");
    expect(listing.items.map((i) => i.deployment.gitSha)).toEqual([sha("b"), sha("a")]);
    expect(listing.items[0]!.tickets).toEqual([
      { key: storyKey, title: "Releases API", epicKey: null },
    ]);
    expect(listing.items[0]!.release.groups[0]!.lines[0]!.text).toBe("Andy can list releases.");
    expect(listing.items[1]!.release.status).toBe("first");
  });

  it("GivenAListedRelease_WhenListedAgain_ThenTheCodeHostIsComparedOnce", async () => {
    const spy = vi.spyOn(t.host, "listCommitsBetween");
    const first = await (await t.call("/api/projects/ai/releases")).json();
    const second = await (await t.call("/api/projects/ai/releases")).json();
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("GivenTheSameProject_WhenListedOverMcp_ThenTheSameDataAsTheRoute", async () => {
    const route = (await (
      await t.call("/api/projects/ai/releases?limit=5")
    ).json()) as ReleaseListing;
    const mcp = await mcpCaller(t.app, grants, MCP_URL);
    const result = await mcp("list_releases", { project: "AI", limit: 5 });
    expect(result.isError).toBe(false);
    const { text, ...data } = result.data as ReleaseListing & { text: string };
    expect(data).toEqual(route);
    expect(result.text).toBe(text);
    expect(result.text).toContain("AI prod releases: 2 deployments, newest first.");
    expect(result.text).toContain(`Tickets: ${storyKey}: Releases API`);
    expect(result.text).toContain("- Andy can list releases. · PR #7");
  });

  it("GivenAnEnvironmentAndLimit_WhenListed_ThenFilteredAndCapped", async () => {
    await deploy(sha("d"), "2026-11-20T13:00:00.000Z", "dev");
    const dev = (await (
      await t.call("/api/projects/ai/releases?env=dev")
    ).json()) as ReleaseListing;
    expect(dev.items.map((i) => i.deployment.environment)).toEqual(["dev"]);
    const one = (await (
      await t.call("/api/projects/ai/releases?limit=1")
    ).json()) as ReleaseListing;
    expect(one.items).toHaveLength(1);
  });

  it("GivenABadQuery_WhenListed_Then400", async () => {
    expect((await t.call("/api/projects/ai/releases?env=preview")).status).toBe(400);
    expect((await t.call("/api/projects/ai/releases?limit=101")).status).toBe(400);
    expect((await t.call("/api/projects/ai/releases?limit=0")).status).toBe(400);
  });

  it("GivenAnUnknownProject_WhenListed_Then404AndANotFoundToolError", async () => {
    expect((await t.call("/api/projects/zz/releases")).status).toBe(404);
    const mcp = await mcpCaller(t.app, grants, MCP_URL);
    const result = await mcp("list_releases", { project: "ZZ" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/);
  });

  it("GivenACallerWhoIsNotAMember_WhenListed_Then404AndANotFoundToolError", async () => {
    await setup({ canRead: (_, projectId) => Promise.resolve(projectId !== "ai") });
    const spy = vi.spyOn(t.host, "listCommitsBetween");
    expect((await t.call("/api/projects/ai/releases")).status).toBe(404);
    const mcp = await mcpCaller(t.app, grants, MCP_URL);
    const result = await mcp("list_releases", { project: "AI" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("GivenNoSignIn_WhenListed_Then401", async () => {
    expect((await t.call("/api/projects/ai/releases", {}, null)).status).toBe(401);
  });
});
