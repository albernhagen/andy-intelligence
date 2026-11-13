import { renderBrief, BRIEF_PATH } from "@andy/domain";
import type { BriefAnswers } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";

/** AI-107: `POST /api/projects/{id}/brief` end to end in-process, with the code host fake. */

const answers: BriefAnswers = {
  projectName: "andy-intelligence",
  idea: "A personal control plane for agentic software development.",
  problem: "Side projects need more keyboard time than Andy has.",
  users: "Andy only.",
  business: "No revenue intent.",
  vision: "Side projects run in production with little keyboard time.",
  goals: ["Minimal keyboard time"],
  nonGoals: ["Multi-tenant SaaS"],
  stack: "TypeScript monorepo.",
  cloud: "GCP, scale to zero.",
  environments: "Dev and prod.",
  constraints: "Public repo.",
  qualityBar: "Tests, CI green, reviews passed.",
  openQuestions: [],
};

async function setup(connected = true) {
  const t = githubApp();
  if (connected) await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const submit = (body: unknown, project = "ai") =>
    t.call(`/api/projects/${project}/brief`, { method: "POST", body: JSON.stringify(body) });
  return { ...t, submit };
}

describe("POST /api/projects/{projectId}/brief", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAnswers_WhenAndySubmits_Then201AndAPrWithTheRenderedBrief", async () => {
    const s = await setup();
    const res = await s.submit(answers);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      status: "opened",
      revised: false,
      pullRequest: { number: 1000, url: `https://github.com/${REPO}/pull/1000` },
    });
    const rendered = renderBrief(answers);
    expect(s.host.proposals[0]!.proposal).toMatchObject({
      path: BRIEF_PATH,
      content: rendered.ok ? rendered.markdown : "",
    });
  });

  it("GivenTheSameBriefOnMain_WhenSubmitted_Then200UnchangedAndNoPr", async () => {
    const s = await setup();
    const rendered = renderBrief(answers);
    s.host.files.set(BRIEF_PATH, rendered.ok ? rendered.markdown : "");
    const res = await s.submit(answers);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unchanged" });
    expect(s.host.proposals).toHaveLength(0);
  });

  it("GivenASectionOverItsCap_WhenSubmitted_Then422NamingItAndNoPr", async () => {
    const s = await setup();
    const vision = Array.from({ length: 81 }, (_, i) => `w${i}`).join(" ");
    const res = await s.submit({ ...answers, vision });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ details: ["Vision"] });
    expect(s.host.proposals).toHaveLength(0);
  });

  it("GivenMalformedAnswers_WhenSubmitted_Then400", async () => {
    const s = await setup();
    expect((await s.submit({ ...answers, goals: [] })).status).toBe(400);
  });

  it("GivenNoSignIn_WhenSubmitted_Then401AndNoPr", async () => {
    const s = await setup();
    const res = await s.call(
      "/api/projects/ai/brief",
      { method: "POST", body: JSON.stringify(answers) },
      null,
    );
    expect(res.status).toBe(401);
    expect(s.host.proposals).toHaveLength(0);
  });

  it("GivenAnUnknownProject_WhenSubmitted_Then404", async () => {
    const s = await setup();
    expect((await s.submit(answers, "zz")).status).toBe(404);
  });

  it("GivenGitHubNotConnected_WhenSubmitted_Then422NoRepoWithTheAppAndNoPr", async () => {
    const s = await setup(false);
    const res = await s.submit(answers);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "project AI has no repo with the App" });
    expect(s.host.proposals).toHaveLength(0);
  });
});
