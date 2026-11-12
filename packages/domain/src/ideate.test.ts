import { InMemoryCodeHost, InMemoryWorkTracker } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDEATE_PRS_PER_HOUR, IdeateService, epicBody, ideaTitle } from "./ideate";
import { TicketService } from "./tickets";

const REPO = "albernhagen/trail-log";
const OWNER = "user:uid-1" as const;
const T0 = new Date("2026-11-12T11:00:00.000Z");

const epicResult = {
  summary: "Weekly summary for runs.",
  outcome: "epic" as const,
  epic: {
    title: "Andy sees his week",
    body: "Runs pile up with no overview.",
    acceptanceCriteria: ["WHEN Andy opens the week THE SYSTEM SHALL show totals"],
    slices: [{ title: "Totals", summary: "Sum the week." }],
  },
  spec: { path: "specs/weekly-summary.md", markdown: "## Problem\n\nNo overview." },
  questions: [],
};
const questionResult = {
  summary: "Team accounts contradict a non-goal.",
  outcome: "question" as const,
  epic: null,
  spec: null,
  questions: [
    {
      question:
        "This idea adds team accounts, but the brief rules out multi-user: update the brief or change the idea?",
      context: "Team accounts let friends log runs. The brief's non-goals say Andy only.",
      options: [
        { label: "Update the brief", consequence: "The epic goes ahead." },
        { label: "Drop it", consequence: "Nothing is built." },
      ],
      recommendation: { answer: "Drop it", reason: "Andy only, for now." },
    },
  ],
};

async function setup(repos = [REPO]) {
  const tracker = new InMemoryWorkTracker();
  const host = new InMemoryCodeHost([
    { fullName: REPO, defaultBranch: "main", private: false, url: `https://github.com/${REPO}` },
  ]);
  const project = await tracker.createProject({ name: "Trail log", key: "TRL", repos });
  let now = T0;
  let n = 0;
  const ideate = new IdeateService(
    tracker,
    new TicketService(tracker, null, null, () => now),
    host,
    () => now,
    () => `tail000${++n}`,
  );
  return {
    tracker,
    host,
    project,
    ideate,
    tick: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

describe("IdeateService", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("GivenAnEpicResult_WhenSubmitted_ThenAnEpicInIdeasAndASpecPr", async () => {
    const { tracker, host, project, ideate } = await setup();
    const res = await ideate.submit(
      project.id,
      { idea: "A weekly summary", result: epicResult },
      OWNER,
    );
    expect(res.outcome).toBe("epic");
    if (res.outcome !== "epic") return;
    expect(res.epic).toMatchObject({
      key: "TRL-1",
      type: "epic",
      stage: "backlog",
      upNextRank: null,
    });
    expect(res.epic.acceptanceCriteria).toEqual(epicResult.epic.acceptanceCriteria);
    expect(res.epic.body).toBe(epicBody(epicResult.epic, "specs/weekly-summary.md"));
    expect(host.proposals[0]).toMatchObject({
      fullName: REPO,
      proposal: {
        branch: "ideate/weekly-summary-20261112110000-tail0001",
        path: "specs/weekly-summary.md",
        content: "## Problem\n\nNo overview.\n",
        title: "TRL-1: Spec draft: Andy sees his week",
      },
    });
    expect(res.specPullRequest).toMatchObject({ number: 1000 });
    const events = await tracker.listEvents(project.id, res.epic.id);
    expect(events.map((e) => e.kind)).toContain("pr_linked");
  });

  it("GivenAQuestionResult_WhenSubmitted_ThenAQuestionInNeedsYouAndNoEpicOrPr", async () => {
    const { tracker, host, project, ideate } = await setup();
    const res = await ideate.submit(
      project.id,
      { idea: "Team accounts\nfor friends", result: questionResult },
      OWNER,
    );
    expect(res.outcome).toBe("question");
    const tickets = await tracker.listTickets(project.id);
    expect(tickets.map((t) => [t.type, t.title])).toEqual([[null, "Idea: Team accounts"]]);
    const open = await tracker.listQuestions({ status: "open" });
    expect(open).toMatchObject([
      {
        ticketId: tickets[0]!.id,
        text: questionResult.questions[0]!.question,
        suggestedAnswer: "Drop it",
      },
    ]);
    expect(host.proposals).toEqual([]);
  });

  it("GivenAProjectWithoutARepo_WhenAnEpicIsSubmitted_ThenRefusedAndNothingCreated", async () => {
    const { tracker, project, ideate } = await setup([]);
    await expect(
      ideate.submit(project.id, { idea: "x", result: epicResult }, OWNER),
    ).rejects.toMatchObject({ code: "invalid_repo" });
    expect(await tracker.listTickets(project.id)).toEqual([]);
  });

  it("GivenTheHostRefusesThePr_WhenSubmitted_ThenTheEpicStaysWithACommentSayingWhy", async () => {
    const { tracker, host, project, ideate } = await setup();
    host.failPropose = new Error("branch exists");
    const res = await ideate.submit(project.id, { idea: "x", result: epicResult }, OWNER);
    expect(res).toMatchObject({ outcome: "epic", specPullRequest: null });
    if (res.outcome !== "epic") return;
    const events = await tracker.listEvents(project.id, res.epic.id);
    expect(events.find((e) => e.kind === "comment")?.body).toContain(
      "could not be opened: branch exists",
    );
  });

  it.each(["agent:run-1", "system"] as const)(
    "GivenTheCaller%s_WhenSubmitting_ThenForbidden",
    async (actor) => {
      const { tracker, project, ideate } = await setup();
      await expect(
        ideate.submit(project.id, { idea: "x", result: epicResult }, actor),
      ).rejects.toMatchObject({
        code: "forbidden",
      });
      expect(await tracker.listTickets(project.id)).toEqual([]);
    },
  );

  it("GivenAMismatchedResult_WhenSubmitted_ThenRefusedAndNothingCreated", async () => {
    const { tracker, project, ideate } = await setup();
    await expect(
      ideate.submit(project.id, { idea: "x", result: { ...epicResult, spec: null } }, OWNER),
    ).rejects.toThrow();
    expect(await tracker.listTickets(project.id)).toEqual([]);
  });

  it("GivenTheHourlyCapReached_WhenAnotherEpicIsSubmitted_ThenRateLimited", async () => {
    const { project, ideate, tick } = await setup();
    for (let i = 0; i < IDEATE_PRS_PER_HOUR; i++) {
      await ideate.submit(project.id, { idea: "x", result: epicResult }, OWNER);
      tick(1000);
    }
    await expect(
      ideate.submit(project.id, { idea: "x", result: epicResult }, OWNER),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("GivenALongIdea_WhenTitled_ThenItIsCut", () => {
    expect(ideaTitle("x".repeat(200)).length).toBeLessThanOrEqual(96);
    expect(ideaTitle("# heading idea")).toBe("Idea: \\# heading idea");
  });
});
