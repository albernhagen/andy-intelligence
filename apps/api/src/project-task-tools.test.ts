import { InMemoryOAuthGrantStore } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";

/**
 * AI-320: starting the plan-project and ideate agent tasks over MCP (`start_plan_project`,
 * `start_ideate`) does what `POST …/plan/agent-task` and `POST …/ideate/agent-task` do: one
 * service, the same task, the same refusals. GitHub is faked, as in project-task-flow.test.ts.
 */

const PUBLIC_URL = "http://localhost";

async function setup(connected = true) {
  const grants = new InMemoryOAuthGrantStore();
  const t = githubApp(
    {},
    { mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() } },
  );
  if (connected) await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const project = await t.tracker.createProject({ name: "Trail log", key: "TRL", repos: [REPO] });
  const mcp = await mcpCaller(t.app, grants, `${PUBLIC_URL}/mcp`);
  const rest = async (path: string, body: unknown = {}) => {
    const res = await t.call(`/api/projects/${project.id}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json()) as any };
  };
  return { t, mcp, rest, project };
}

describe("project agent tasks over MCP and REST (AI-320 parity)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAProject_WhenAndyStartsPlanProjectOverMcp_ThenTheSameTaskStartsAndRestThenRefusesASecond", async () => {
    const { t, mcp, rest, project } = await setup();

    const started = await mcp("start_plan_project", { project: "trl" });
    expect(started.isError).toBe(false);
    expect(started.data.run).toMatchObject({ step: "plan-project", status: "queued" });
    const [run] = await t.runs.listActive(project.id);
    expect(run).toMatchObject({ id: started.data.run.id, ticketId: null, step: "plan-project" });
    expect(t.host.workflowRuns.size).toBe(1);

    const second = await rest("/plan/agent-task");
    expect(second.status).toBe(409);
    const viaMcp = await mcp("start_plan_project", { project: "TRL" });
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toContain(second.json.error);
    expect(t.host.workflowRuns.size).toBe(1);
  });

  it("GivenAnIdea_WhenAndyStartsIdeateOverMcp_ThenTheTaskKeepsTheIdeaAndASecondIsRefusedOnBothSides", async () => {
    const { t, mcp, rest, project } = await setup();

    const started = await mcp("start_ideate", { project: "TRL", idea: "A weekly summary" });
    expect(started.isError).toBe(false);
    expect(started.data.run).toMatchObject({ step: "ideate", status: "queued" });
    const [run] = await t.runs.listActive(project.id);
    expect(run).toMatchObject({ step: "ideate", ticketId: null, idea: "A weekly summary" });

    const viaRest = await rest("/ideate/agent-task", { idea: "Another" });
    expect(viaRest.status).toBe(409);
    expect(viaRest.json.error).toMatch(/already has a ideate task in flight/);
    const viaMcp = await mcp("start_ideate", { project: "TRL", idea: "Another" });
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toContain(viaRest.json.error);
  });

  it("GivenADialOfOne_WhenAPlanProjectRuns_ThenIdeateIsRefusedAtTheDialOverBoth", async () => {
    const { t, mcp, rest, project } = await setup();
    await t.tracker.updateProject(project.id, { runsAtOnce: 1 });
    expect((await mcp("start_plan_project", { project: "TRL" })).isError).toBe(false);

    const viaRest = await rest("/ideate/agent-task", { idea: "x" });
    expect(viaRest.status).toBe(409);
    expect(viaRest.json.error).toMatch(/agent-tasks-at-once dial/);
    const viaMcp = await mcp("start_ideate", { project: "TRL", idea: "x" });
    expect(viaMcp.text).toContain(viaRest.json.error);
  });

  it("GivenGitHubNotConnected_WhenStartingOverMcp_ThenItFailsAsRestDoesAndNothingIsInFlight", async () => {
    const { t, mcp, rest, project } = await setup(false);

    const viaRest = await rest("/plan/agent-task");
    expect(viaRest.status).toBe(502);
    const viaMcp = await mcp("start_plan_project", { project: "TRL" });
    expect(viaMcp.isError).toBe(true);
    expect(await t.runs.listActive(project.id)).toEqual([]);
  });

  it("GivenABlankIdea_WhenStartingIdeateOverMcp_ThenItIsRefusedAndNothingStarts", async () => {
    const { t, mcp, project } = await setup();

    const res = await mcp("start_ideate", { project: "TRL", idea: "   " });
    expect(res.isError).toBe(true);
    expect(await t.runs.listActive(project.id)).toEqual([]);
  });
});
