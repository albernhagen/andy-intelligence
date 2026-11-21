import {
  InMemoryCodeHost,
  InMemoryRunStore,
  InMemoryWorkTracker,
  RUN_PROMPT_MAX,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEF_PATH } from "./brief";
import { RunService } from "./runs";
import { WorkflowExecutor } from "./test-executor";

const REPO = {
  fullName: "albernhagen/trail-log",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/trail-log",
};
const NOW = new Date("2026-11-20T12:00:00.000Z");
const BRIEF = [
  "# Project brief — Trail log",
  "",
  "## Goals and non-goals",
  "",
  "Goals, in priority order:",
  "",
  "1. Zero typing",
  "",
  "## Architectural expectations",
  "",
  "- **Stack:** TypeScript, React.",
  "- **Cloud:** GCP, scale to zero.",
  "",
  "## Open questions",
  "",
  "None yet.",
  "",
].join("\n");

/** The brief text the prompt carries, decoded from its `<brief>` block; null without one. */
const briefIn = (prompt: string | null) => {
  const m = /\n<brief>\n([\s\S]*?)\n<\/brief>/.exec(prompt ?? "");
  return m ? (JSON.parse(m[1]!) as { part: string; text: string }) : null;
};

describe("RunService brief in context (AI-112)", () => {
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;
  let host: InMemoryCodeHost;
  let service: RunService;
  let projectId: string;

  const readyTicket = async () => {
    const t = await tracker.createTicket(
      projectId,
      {
        type: "feature",
        title: "Log a run",
        body: "Andy logs a run.",
        acceptanceCriteria: ["WHEN Andy finishes a run THE SYSTEM SHALL log it"],
        size: "S",
        sizeReason: "one screen",
      },
      "andy",
    );
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };
  const refineTicket = async (body?: string) => {
    const t = await tracker.createTicket(projectId, { title: "Log a run", body }, "andy");
    await tracker.updateTicket(projectId, t.id, { fields: { upNextRank: "0000000001" } }, "andy");
    return t;
  };

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker(() => NOW);
    runs = new InMemoryRunStore(() => NOW);
    host = new InMemoryCodeHost([REPO]);
    service = new RunService(
      tracker,
      runs,
      new WorkflowExecutor(host),
      () => NOW,
      null,
      null,
      host,
    );
    projectId = (await tracker.createProject({ name: "Trail", key: "TL", repos: [REPO.fullName] }))
      .id;
    await tracker.updateProject(projectId, { buildEnabled: true });
  });

  it("GivenAProjectWithABrief_WhenARefineTaskIsDispatched_ThenItsPromptCarriesTheWholeBrief", async () => {
    host.files.set(BRIEF_PATH, BRIEF);
    const run = await service.start(projectId, (await refineTicket()).id, "refine");
    expect(briefIn(run.prompt)).toMatchObject({ part: "whole", text: BRIEF.trim() });
    const context = await service.context(run.id, run.executor!);
    expect(briefIn(context.prompt)?.text).toBe(BRIEF.trim());
    expect(context.prompt.indexOf("<ticket>")).toBeLessThan(context.prompt.indexOf("<brief>"));
  });

  it("GivenAProjectWithABrief_WhenABuildTaskIsDispatched_ThenItsPromptCarriesOnlyArchitecturalExpectations", async () => {
    host.files.set(BRIEF_PATH, BRIEF);
    const run = await service.start(projectId, (await readyTicket()).id, "build");
    expect(briefIn(run.prompt)).toEqual({
      source: BRIEF_PATH,
      part: "Architectural expectations",
      truncated: false,
      text: "- **Stack:** TypeScript, React.\n- **Cloud:** GCP, scale to zero.",
    });
  });

  it("GivenAProjectWithoutABrief_WhenARefineTaskIsDispatched_ThenItStartsWithNoBriefBlock", async () => {
    const run = await service.start(projectId, (await refineTicket()).id, "refine");
    expect(run.status).toBe("queued");
    expect(run.prompt).not.toContain("<brief>");
  });

  it("GivenTheBriefCantBeRead_WhenARefineTaskIsDispatched_ThenItStartsWithoutTheBriefAndLogsWhy", async () => {
    vi.spyOn(host, "readFile").mockRejectedValue(new Error("docs/product/brief.md is too large"));
    const run = await service.start(projectId, (await refineTicket()).id, "refine");
    expect(run.status).toBe("queued");
    expect(run.prompt).not.toContain("<brief>");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("project brief not read; the agent task starts without it"),
    );
  });

  it("GivenABriefWithoutArchitecturalExpectations_WhenABuildTaskIsDispatched_ThenItStartsWithNoBriefBlock", async () => {
    host.files.set(BRIEF_PATH, "# Project brief\n\n## Idea\n\nA log of trail runs.\n");
    const run = await service.start(projectId, (await readyTicket()).id, "build");
    expect(run.status).toBe("queued");
    expect(run.prompt).not.toContain("<brief>");
  });

  it("GivenATicketThatLeavesNoRoomForTheBrief_WhenARefineTaskIsDispatched_ThenItStartsWithoutTheBriefUnderThePromptCap", async () => {
    host.files.set(BRIEF_PATH, `## Idea\n\n${"<".repeat(20_000)}`);
    const run = await service.start(
      projectId,
      (await refineTicket("x".repeat(95_000))).id,
      "refine",
    );
    expect(run.status).toBe("queued");
    expect(run.prompt).not.toContain("<brief>");
    expect(run.prompt!.length).toBeLessThanOrEqual(RUN_PROMPT_MAX);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("project brief left out: the prompt would pass its cap"),
    );
  });
});
