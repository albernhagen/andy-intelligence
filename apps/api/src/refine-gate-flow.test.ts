import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import {
  InMemoryOAuthGrantStore,
  type Assumption,
  type Digest,
  type Question,
  type Ticket,
} from "@andy/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import type { ActionsClaims } from "./github/token";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";

/**
 * AI-39: Refine as the gate into the queue, end to end in-process (ADR-0075): the real API, domain
 * and dispatcher with only GitHub faked. Tickets start as Ideas; only Up next runs refine.
 */

const verify = async (jwt: string): Promise<ActionsClaims> => JSON.parse(jwt) as ActionsClaims;

const gap = (question: string, over: object = {}) => ({
  question,
  assumption: `Assume ${question}`,
  context: `Context for ${question}`,
  options: [],
  recommendation: { answer: "yes", reason: "the simplest" },
  cost: "direction",
  confidence: "unsure",
  urgency: "normal",
  ...over,
});
const cheap = (q: string) => gap(q, { cost: "reversible", confidence: "sure" });
const output = (over: object) => ({
  summary: "**Ask**: a board",
  type: "feature",
  size: "S",
  sizeReason: "one screen",
  risk: "low",
  riskReason: "one screen, no data",
  confidence: "high",
  confidenceReason: "the code answers it",
  outOfScope: [],
  touches: [],
  body: "Andy can't see his tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  outcome: "ready",
  reason: null,
  children: [],
  gaps: [],
  ...over,
});

interface RunBody {
  id: string;
  step: string;
  status: string;
  prompt: string | null;
  executor: { externalId: string } | null;
}

async function setup() {
  const grants = new InMemoryOAuthGrantStore();
  const t = githubApp(
    { verifyActionsToken: verify },
    { mcp: { publicUrl: "https://cp.example", grants, clients: new ClientMetadataResolver() } },
  );
  const mcp = () => mcpCaller(t.app, grants, "https://cp.example/mcp");
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const project = await t.tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
  const base = `/api/projects/${project.id}`;
  const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
  const post = (path: string, body: unknown = {}) =>
    t.call(path, { method: "POST", body: JSON.stringify(body) });
  const path = (id: string) => `${base}/tickets/${id}`;
  const create = (body: object = {}) =>
    json<Ticket>(post(`${base}/tickets`, { title: "Board", ...body }));
  const ticket = (id: string) => json<Ticket>(t.call(path(id)));
  const runs = async (id: string) =>
    (await json<RunBody[]>(t.call(`${path(id)}/runs`))).filter((r) => r.step === "refine");
  const toUpNext = (id: string) => post(`${path(id)}/up-next`, { upNext: true });
  const inbox = () => json<{ questions: Question[]; tickets: Ticket[] }>(t.call("/api/needs-you"));
  const questions = (id: string) => json<Question[]>(t.call(`${path(id)}/questions`));

  /** The executor's callback for the ticket's newest refine run. */
  async function report(id: string, result: object) {
    // Newest unfinished run: runs can share a millisecond, so list order can't say.
    const all = await runs(id);
    const run = all.find((r) => r.status !== "succeeded") ?? all[0];
    const claims = {
      repository: REPO,
      workflow_ref: `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
      job_workflow_ref: CLAUDE_EXECUTOR_REF,
      run_id: run!.executor!.externalId,
    } satisfies ActionsClaims;
    const res = await t.call(
      `/runs/${run!.id}/report`,
      {
        method: "POST",
        body: JSON.stringify({
          status: "succeeded",
          summary: "{}",
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
          output: result,
        }),
      },
      JSON.stringify(claims),
    );
    expect(res.status).toBe(200);
  }
  const comments = async (id: string) =>
    (await json<{ kind: string; body: string | null }[]>(t.call(`${path(id)}/events`)))
      .filter((e) => e.kind === "comment")
      .map((e) => e.body ?? "");
  const answer = (id: string, text = "yes") =>
    post(`/api/questions/${id}/answer`, { answer: text });

  return {
    ...t,
    project,
    base,
    json,
    post,
    path,
    create,
    ticket,
    runs,
    toUpNext,
    inbox,
    questions,
    report,
    comments,
    answer,
    mcp,
  };
}

describe("refine gate flow", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenANewTicket_WhenCreated_ThenItIsAnIdeaAndNoRefineStarts", async () => {
    const t = await setup();
    const created = await t.create();
    expect(created).toMatchObject({ stage: "backlog", upNextRank: null });
    expect(await t.runs(created.id)).toEqual([]);
  });

  it("GivenAnIdea_WhenRefineIsStartedByHand_ThenItIsRefused", async () => {
    const t = await setup();
    const created = await t.create();
    const res = await t.post(`${t.path(created.id)}/runs`, { step: "refine" });
    expect(res.status).toBe(422);
    expect(await t.runs(created.id)).toEqual([]);
  });

  it("GivenATicketCreatedWithUpNext_WhenCreated_ThenExactlyOneRefineStarts", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    expect((await t.ticket(created.id)).upNextRank).not.toBeNull();
    expect(await t.runs(created.id)).toHaveLength(1);
  });

  it("GivenAnIdea_WhenMovedToUpNextTwice_ThenExactlyOneRefineStarts", async () => {
    const t = await setup();
    const created = await t.create();
    await t.toUpNext(created.id);
    await t.toUpNext(created.id);
    expect(await t.runs(created.id)).toHaveLength(1);
  });

  it("GivenARefineWithOnlyCheapGaps_WhenReported_ThenReadyNoInboxAndAssumptionsReadable", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(created.id, output({ gaps: [cheap("A?"), cheap("B?")] }));

    const done = await t.ticket(created.id);
    expect(done).toMatchObject({ stage: "ready", needsAttention: false, upNextRank: null });
    expect(done.refineAssumptions.map((a: Assumption) => a.text)).toEqual([
      "Assume A?",
      "Assume B?",
    ]);
    expect(await t.inbox()).toEqual({ questions: [], tickets: [] });
  });

  it("GivenARefineWithTwoQuestions_WhenReported_ThenWaitsInUpNextAndTheLastAnswerMovesItToReady", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(created.id, output({ gaps: [gap("A?"), gap("B?")] }));

    expect(await t.ticket(created.id)).toMatchObject({ stage: "backlog", needsAttention: true });
    const { questions } = await t.inbox();
    expect(questions.map((q) => q.text)).toEqual(["A?", "B?"]);
    expect(questions[0]?.suggestedAnswer).toBe("yes");

    await t.answer(questions[0]!.id);
    expect((await t.ticket(created.id)).stage).toBe("backlog");
    await t.answer(questions[1]!.id);
    expect((await t.ticket(created.id)).stage).toBe("ready");
    expect(await t.runs(created.id)).toHaveLength(1);
  });

  it("GivenATooVagueReport_WhenReported_ThenBackToIdeasWithTheReasonAndNothingElse", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(
      created.id,
      output({ outcome: "send_back", reason: "Which board?", gaps: [gap("A?")] }),
    );
    const back = await t.ticket(created.id);
    expect(back).toMatchObject({
      stage: "backlog",
      upNextRank: null,
      needsAttention: false,
      sentBackReason: "Which board?",
      size: null,
      body: "",
      refineAssumptions: [],
    });
    expect(await t.questions(created.id)).toEqual([]);
    expect((await t.comments(created.id)).join()).toContain("Back to Ideas: Which board?");
    expect(await t.runs(created.id)).toHaveLength(1);
  });

  it("GivenASentBackTicket_WhenItReentersUpNext_ThenRefineRunsAgainAndTheMarkerClears", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(created.id, output({ outcome: "send_back", reason: "Vague" }));
    await t.toUpNext(created.id);
    expect(await t.runs(created.id)).toHaveLength(2);
    expect((await t.ticket(created.id)).sentBackReason).toBeNull();
  });

  it("GivenASplitReport_WhenReported_ThenChildrenAreIdeasUnderTheEpicAndTheParentLinksThem", async () => {
    const t = await setup();
    const epic = await t.create({ type: "epic", title: "Boards" });
    const created = await t.create({ parentId: epic.id, upNext: true });
    await t.report(
      created.id,
      output({
        outcome: "split",
        reason: "Two features",
        children: [
          { title: "Lanes", body: "Show lanes" },
          { title: "Drag", body: "Drag cards" },
        ],
      }),
    );
    const all = await t.json<Ticket[]>(t.call(`${t.base}/tickets`));
    const kids = all.filter((x) => ["Lanes", "Drag"].includes(x.title));
    expect(kids).toHaveLength(2);
    for (const kid of kids) {
      expect(kid).toMatchObject({ stage: "backlog", upNextRank: null, parentId: epic.id });
    }
    expect((await t.ticket(created.id)).upNextRank).toBeNull();
    const links = (await t.comments(created.id)).join();
    for (const kid of kids) expect(links).toContain(kid.key);
    // Children cost nothing: no refine ran on them.
    expect(await t.runs(kids[0]!.id)).toEqual([]);
  });

  /** A project with a daily cap of 1 already spent, and a ticket whose costly gap it held. */
  async function heldOnTheDailyCap(t: Awaited<ReturnType<typeof setup>>, gaps = [gap("B?")]) {
    await t.call(t.base, { method: "PATCH", body: JSON.stringify({ dailyQuestionCap: 1 }) });
    const first = await t.create({ upNext: true });
    await t.report(first.id, output({ gaps: [gap("A?")] }));
    const second = await t.create({ upNext: true });
    const [q] = await t.questions(first.id);
    await t.answer(q!.id);
    await t.report(second.id, output({ gaps }));
    return second;
  }

  describe("held gaps (AI-75)", () => {
    afterEach(() => vi.useRealTimers());

    it("GivenAProjectAtItsDailyCap_WhenARefineHasACostlyGap_ThenTheTicketIsHeldInUpNextAndNeedsYouAndSaysWhy", async () => {
      const t = await setup();
      const second = await heldOnTheDailyCap(t);

      const held = await t.ticket(second.id);
      expect(await t.questions(second.id)).toEqual([]);
      expect(held).toMatchObject({ stage: "backlog", needsAttention: true, dorStatus: "not_met" });
      expect(held.upNextRank).not.toBeNull();
      expect(held.refineAssumptions[0]).toMatchObject({
        demotedBy: "daily_cap",
        cost: "direction",
        status: "assumed",
      });
      expect((await t.inbox()).tickets.map((x) => x.id)).toContain(second.id);
      expect((await t.comments(second.id)).join()).toContain("daily question cap");

      const call = await t.mcp();
      const { data } = await call("status", { ticket: second.key });
      const status = data as { statusLine: { text: string }; readiness: { missing: string[] } };
      expect(status.statusLine.text).toContain("1 held question");
      expect(status.statusLine.text).toContain("daily question cap");
      expect(status.readiness.missing).toContain("1 held question(s) asked or accepted");
    });

    it("GivenAProjectAtItsDailyCap_WhenAReversibleGapIsDemoted_ThenTheTicketStillReachesReady", async () => {
      const t = await setup();
      const second = await heldOnTheDailyCap(t, [
        gap("B?", { cost: "reversible", confidence: "unsure" }),
      ]);

      const ready = await t.ticket(second.id);
      expect(ready).toMatchObject({ stage: "ready" });
      expect(ready.refineAssumptions[0]).toMatchObject({
        demotedBy: "daily_cap",
        status: "assumed",
      });
    });

    it("GivenAHeldGapOnTheDailyCap_WhenADispatchEventFiresAfterTheWindow_ThenItIsAskedAndItsAnswerReRefinesIt", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-11T09:00:00Z") });
      const t = await setup();
      const second = await heldOnTheDailyCap(t);

      // Inside the window an event (here: a ticket entering Up next) asks nothing.
      const idea = await t.create({ title: "An idea", upNext: true });
      expect(await t.questions(second.id)).toEqual([]);

      // The next event after the window (here: that refine ending) asks it.
      vi.setSystemTime(new Date("2026-11-12T09:00:01Z"));
      await t.report(idea.id, output({ gaps: [] }));
      const [asked] = await t.questions(second.id);
      expect(asked).toMatchObject({ text: "B?", status: "open", context: "Context for B?" });
      const waiting = await t.ticket(second.id);
      expect(waiting.refineAssumptions[0]).toMatchObject({
        status: "promoted",
        questionId: asked!.id,
      });

      await t.answer(asked!.id, "No, C");
      const reRefine = (await t.runs(second.id)).find((r) => r.status !== "succeeded");
      expect(reRefine?.prompt).toContain("No, C");
      await t.report(second.id, output({ gaps: [] }));
      expect(await t.ticket(second.id)).toMatchObject({ stage: "ready" });
    });

    it("GivenAHeldGapAndOneFreeSlot_WhenRetried_ThenNoMoreQuestionsThanTheCapAllowsAreAsked", async () => {
      const t = await setup();
      const created = await t.create({ upNext: true });
      await t.report(
        created.id,
        output({ gaps: ["A?", "B?", "C?", "D?", "E?"].map((q) => gap(q)) }),
      );
      const before = await t.ticket(created.id);
      expect(before.refineAssumptions.map((a) => a.demotedBy)).toEqual([
        "ticket_cap",
        "ticket_cap",
      ]);
      expect(before).toMatchObject({ stage: "backlog", needsAttention: true });

      const [first] = await t.questions(created.id);
      await t.answer(first!.id);
      const open = (await t.questions(created.id)).filter((q) => q.status === "open");
      expect(open.map((q) => q.text)).toEqual(["B?", "C?", "D?"]);
      // Another event with no free slot asks nothing more.
      await t.create({ title: "An idea", upNext: true });
      const after = await t.ticket(created.id);
      expect(after.refineAssumptions.map((a) => a.status)).toEqual(["promoted", "assumed"]);
      expect((await t.questions(created.id)).filter((q) => q.status === "open")).toHaveLength(3);
    });

    it("GivenAHeldGap_WhenAndyPromotesItOverMcp_ThenItIsAnOpenQuestion", async () => {
      const t = await setup();
      const second = await heldOnTheDailyCap(t);
      const [held] = (await t.ticket(second.id)).refineAssumptions;

      const call = await t.mcp();
      await call("promote_assumption", { ticket: second.key, assumptionId: held!.id });
      expect((await t.questions(second.id)).map((q) => q.text)).toEqual(["B?"]);
      expect((await t.ticket(second.id)).refineAssumptions[0]).toMatchObject({
        status: "promoted",
      });
    });

    it("GivenAHeldGap_WhenAndyAcceptsIt_ThenTheTicketIsReleasedToReady", async () => {
      const t = await setup();
      const second = await heldOnTheDailyCap(t);
      const [held] = (await t.ticket(second.id)).refineAssumptions;

      const res = await t.post(`${t.path(second.id)}/assumptions/${held!.id}/accept`);
      expect(res.status).toBe(200);
      const released = await t.ticket(second.id);
      expect(released).toMatchObject({ stage: "ready", needsAttention: false, dorStatus: "met" });
      expect(released.refineAssumptions[0]).toMatchObject({ status: "accepted" });
      expect(await t.questions(second.id)).toEqual([]);
      // The owner-only rule (AI-19) records the signed-in user, never a fixed "andy".
      const events = await t.json<
        { kind: string; actor: string; data: { diff?: Record<string, unknown> } }[]
      >(t.call(`${t.path(second.id)}/events`));
      expect(events.findLast((e) => e.data.diff?.refineAssumptions)?.actor).toMatch(/^user:/);
    });

    it("GivenAnAssumptionThatIsNotHeld_WhenAccepted_ThenRefused", async () => {
      const t = await setup();
      const created = await t.create({ upNext: true });
      await t.report(created.id, output({ gaps: [cheap("A?")] }));
      const [a] = (await t.ticket(created.id)).refineAssumptions;

      const res = await t.post(`${t.path(created.id)}/assumptions/${a!.id}/accept`);
      expect(res.status).toBe(409);
      expect((await t.ticket(created.id)).refineAssumptions[0]).toMatchObject({
        status: "assumed",
      });
    });

    it("GivenAHeldGap_WhenAndyMovesTheTicketToReady_ThenTheDefinitionOfReadyRefusesIt", async () => {
      const t = await setup();
      const second = await heldOnTheDailyCap(t);

      const res = await t.post(`${t.path(second.id)}/stage`, { to: "ready" });
      expect(res.status).toBe(422);
      expect(await t.ticket(second.id)).toMatchObject({ stage: "backlog" });
    });
  });

  it("GivenFourCostlyGaps_WhenReported_ThenThreeQuestionsAndOneAssumption", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(created.id, output({ gaps: ["A?", "B?", "C?", "D?"].map((q) => gap(q)) }));
    expect(await t.questions(created.id)).toHaveLength(3);
    expect((await t.ticket(created.id)).refineAssumptions[0]).toMatchObject({
      demotedBy: "ticket_cap",
    });
  });

  it("GivenAnAssumption_WhenPromotedAndAnswered_ThenOneQuestionThenOnlyThatGapIsReRefined", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(created.id, output({ gaps: [cheap("A?"), cheap("B?")] }));
    const [first] = (await t.ticket(created.id)).refineAssumptions;

    const res = await t.post(`${t.path(created.id)}/assumptions/${first!.id}/promote`);
    expect(res.status).toBe(201);
    const promoted = await t.ticket(created.id);
    expect(promoted).toMatchObject({ stage: "backlog", needsAttention: true });
    expect(promoted.upNextRank).not.toBeNull();
    const open = await t.questions(created.id);
    expect(open.map((q) => q.text)).toEqual(["A?"]);
    expect(await t.runs(created.id)).toHaveLength(1);

    await t.answer(open[0]!.id, "No, the other way");
    const runs = await t.runs(created.id);
    expect(runs).toHaveLength(2);
    // Runs can share a millisecond, so find the re-refine by its prompt, not its list position.
    const reRefine = runs.find((r) => r.prompt?.includes("No, the other way"));
    expect(reRefine?.prompt).toContain('"focusGaps"');

    // The re-refine may not touch anything else, even if the agent tries.
    await t.report(
      created.id,
      output({ outcome: "send_back", reason: "x", gaps: [cheap("New?"), cheap("Other?")] }),
    );
    const after = await t.ticket(created.id);
    expect(after.stage).toBe("ready");
    expect(after.refineAssumptions.map((a) => [a.text, a.status])).toEqual([
      ["Assume A?", "settled"],
      ["Assume B?", "assumed"],
      ["Assume New?", "assumed"],
    ]);
  });

  it("GivenAnIdeaWithAnOpenQuestion_WhenAnswered_ThenItStaysAnIdea", async () => {
    const t = await setup();
    const created = await t.create({
      type: "chore",
      body: "b",
      acceptanceCriteria: ["done"],
      size: "S",
      sizeReason: "r",
    });
    const asked = await t.json<Question>(
      t.post(`${t.path(created.id)}/questions`, { text: "Old?" }),
    );
    await t.answer(asked.id);
    expect(await t.ticket(created.id)).toMatchObject({
      stage: "backlog",
      upNextRank: null,
      needsAttention: false,
    });
    expect(await t.runs(created.id)).toEqual([]);
  });

  it("GivenAPromotedGapAnsweredBeforeAnotherQuestion_WhenTheLastIsAnswered_ThenTheGapIsReRefinedBeforeReady", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(created.id, output({ gaps: [gap("Q1?"), cheap("A?")] }));
    const [assumption] = (await t.ticket(created.id)).refineAssumptions;
    await t.post(`${t.path(created.id)}/assumptions/${assumption!.id}/promote`);
    const open = await t.questions(created.id);
    const promoted = open.find((q) => q.text === "A?")!;
    const other = open.find((q) => q.text === "Q1?")!;

    await t.answer(promoted.id, "the promoted answer");
    await t.answer(other.id);

    expect((await t.ticket(created.id)).stage).toBe("backlog");
    const runs = await t.runs(created.id);
    expect(runs).toHaveLength(2);
    // Runs can share a millisecond, so don't rely on list order: only the re-refine sees the answer.
    expect(runs.filter((r) => r.prompt?.includes("the promoted answer"))).toHaveLength(1);
  });

  it("GivenASameTitledTicketMadeDuringARun_WhenSplit_ThenItIsNotAdoptedAndDuplicateTitlesBothExist", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    const andys = await t.create({ title: "Lanes" });
    await t.report(
      created.id,
      output({
        outcome: "split",
        reason: "Too big",
        children: [
          { title: "Lanes", body: "One" },
          { title: "Lanes", body: "Two" },
        ],
      }),
    );
    const lanes = (await t.json<Ticket[]>(t.call(`${t.base}/tickets`))).filter(
      (x) => x.title === "Lanes",
    );
    expect(lanes).toHaveLength(3);
    expect(lanes.find((x) => x.id === andys.id)?.body).toBe("");
  });

  it("GivenAPromotedAssumption_WhenTheTicketGoesBackToIdeas_ThenTheQuestionIsWithdrawn", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(created.id, output({ gaps: [gap("A?"), cheap("B?")] }));
    await t.post(`${t.path(created.id)}/up-next`, { upNext: false });
    expect((await t.questions(created.id))[0]?.status).toBe("withdrawn");
    expect(await t.ticket(created.id)).toMatchObject({ needsAttention: false, upNextRank: null });
  });

  it("GivenABuildStarted_WhenAnAssumptionIsPromoted_ThenRefused", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(created.id, output({ gaps: [cheap("A?")] }));
    const [first] = (await t.ticket(created.id)).refineAssumptions;
    await t.post(`${t.path(created.id)}/stage`, { to: "in_progress" });
    const res = await t.post(`${t.path(created.id)}/assumptions/${first!.id}/promote`);
    expect(res.status).toBe(409);
  });

  it("GivenADoneTicket_WhenMovedToUpNextOrRefined_ThenRefusedAndNoRunStarts", async () => {
    const t = await setup();
    const created = await t.create();
    await t.post(`${t.path(created.id)}/stage`, { to: "done", force: true });
    expect((await t.toUpNext(created.id)).status).toBe(422);
    expect((await t.post(`${t.path(created.id)}/runs`, { step: "refine" })).status).toBe(422);
    expect(await t.runs(created.id)).toEqual([]);
  });

  it("GivenARefineWithScores_WhenASecondRunDisagrees_ThenTheFirstScoresAndReasonsStayAndHistoryShowsThem", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(created.id, output({}));

    const scored = await t.ticket(created.id);
    expect(scored).toMatchObject({
      stage: "ready",
      risk: "low",
      riskReason: "one screen, no data",
      confidence: "high",
      confidenceReason: "the code answers it",
    });
    const events = await t.json<{ kind: string; data: { diff?: Record<string, unknown> } }[]>(
      t.call(`${t.path(created.id)}/events`),
    );
    expect(
      events.find((e) => e.kind === "fields_changed" && e.data.diff?.risk)?.data.diff,
    ).toMatchObject({ risk: { from: null, to: "low" }, confidence: { from: null, to: "high" } });

    await t.post(`${t.path(created.id)}/stage`, { to: "backlog" });
    // One refine per entry is judged by timestamp: the new entry must land in a later millisecond.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await t.toUpNext(created.id);
    expect(await t.runs(created.id)).toHaveLength(2);
    await t.report(
      created.id,
      output({
        risk: "high",
        riskReason: "second opinion",
        confidence: "low",
        confidenceReason: "second opinion",
      }),
    );
    expect(await t.ticket(created.id)).toMatchObject({
      stage: "ready",
      risk: "low",
      riskReason: "one screen, no data",
      confidence: "high",
      confidenceReason: "the code answers it",
    });
  });

  it("GivenARefineWithoutRisk_WhenReported_ThenTheResultIsRejectedAndNothingIsWritten", async () => {
    const t = await setup();
    const created = await t.create({ upNext: true });
    await t.report(created.id, output({ risk: undefined }));
    expect(await t.ticket(created.id)).toMatchObject({ risk: null, size: null, stage: "backlog" });
  });

  describe("question format (AI-73)", () => {
    const line =
      "Should agent evals in CI (AI-6: Agent evals v1) bill model calls to Andy's subscription?";
    const wellFormed = gap(line, {
      context:
        "Agent evals run every agent against fixed tickets to catch regressions. Today nothing runs them. CI needs a way to pay for the model calls before the workflow lands.",
      options: [
        { label: "Subscription", consequence: "No new spend; evals share the weekly quota." },
        { label: "API key", consequence: "Pay per call, about $2 a run; needs a new secret." },
      ],
      recommendation: { answer: "Subscription", reason: "No new secret and no new bill." },
    });

    it("GivenAWellFormedQuestion_WhenReported_ThenStoredWithTheFormatAndListNeedsMeShowsItInOrder", async () => {
      const t = await setup();
      const created = await t.create({ upNext: true });
      await t.report(created.id, output({ gaps: [wellFormed] }));

      const [stored] = await t.questions(created.id);
      expect(stored).toMatchObject({
        text: line,
        context: wellFormed.context,
        choices: wellFormed.options,
        recommendation: wellFormed.recommendation,
        // Older readers keep working: labels and the suggested answer are still filled.
        options: ["Subscription", "API key"],
        suggestedAnswer: "Subscription",
      });

      const call = await t.mcp();
      const { data } = await call("list_needs_me");
      const [question] = data.cards[0].questions;
      expect(Object.keys(question).slice(0, 6)).toEqual([
        "id",
        "ticket",
        "question",
        "context",
        "choices",
        "recommendation",
      ]);
      expect(question).toMatchObject({
        ticket: "AI-1",
        question: line,
        context: wellFormed.context,
        choices: wellFormed.options,
        recommendation: wellFormed.recommendation,
      });
    });

    it.each([
      [
        "a bare label",
        { question: "AI-6: M1.17: Agent evals v1, q1: who pays for model calls in CI." },
      ],
      ["no context", { context: undefined }],
      ["an option without a consequence", { options: [{ label: "Subscription" }] }],
      ["bare-string options", { options: ["Subscription", "API key"] }],
      [
        "a recommendation that is not an option",
        { recommendation: { answer: "Subscription (no new secret)", reason: "No new bill." } },
      ],
    ])(
      "GivenAQuestionWith%s_WhenReported_ThenTheResultIsRejectedAndNothingIsAsked",
      async (_, over) => {
        const t = await setup();
        const created = await t.create({ upNext: true });
        await t.report(created.id, output({ gaps: [{ ...wellFormed, ...over }] }));

        expect(await t.questions(created.id)).toEqual([]);
        expect(await t.ticket(created.id)).toMatchObject({ stage: "backlog", size: null });
        const [run] = await t.runs(created.id);
        expect(run?.status).toBe("failed");
      },
    );

    it("GivenAQuestionStoredBeforeTheFormat_WhenListed_ThenItReadsAsBefore", async () => {
      const t = await setup();
      const created = await t.create();
      await t.tracker.askQuestion(
        t.project.id,
        created.id,
        { text: "Kanban or list?", options: ["Kanban", "List"], suggestedAnswer: "Kanban" },
        "agent:r1",
      );

      const call = await t.mcp();
      const [question] = (await call("list_needs_me")).data.cards[0].questions;
      expect(question).toMatchObject({
        question: "Kanban or list?",
        context: null,
        choices: [],
        recommendation: null,
        text: "Kanban or list?",
        options: ["Kanban", "List"],
        suggestedAnswer: "Kanban",
      });
    });

    it("GivenATicketWaitingOnAQuestion_WhenTheDigestIsRead_ThenItShowsTheQuestionLine", async () => {
      const t = await setup();
      const created = await t.create({ upNext: true });
      await t.report(created.id, output({ gaps: [wellFormed] }));

      const call = await t.mcp();
      const { data, text } = await call("digest", { project: "AI" });
      const waiting = (data as Digest).exceptions.find((e) => e.kind === "waiting_on_andy");
      expect(waiting?.reason).toBe(`Waiting for you: ${line}`);
      expect(text).toContain(line);
      expect(text).not.toContain("q1");
    });
  });

  it("GivenAFlagLeftOnADoneTicket_WhenTheInboxIsRead_ThenItIsNotListed", async () => {
    const t = await setup();
    const created = await t.create();
    await t.tracker.updateTicket(
      t.project.id,
      created.id,
      { fields: { needsAttention: true } },
      "andy",
    );
    await t.post(`${t.path(created.id)}/stage`, { to: "done", force: true });
    expect((await t.inbox()).tickets).toEqual([]);
    expect((await t.ticket(created.id)).needsAttention).toBe(false);
  });

  it("GivenAnEpic_WhenMovedToUpNext_ThenRefused", async () => {
    const t = await setup();
    const epic = await t.create({ type: "epic" });
    expect((await t.toUpNext(epic.id)).status).toBe(422);
    expect(await t.runs(epic.id)).toEqual([]);
  });

  it("GivenARankInTheBody_WhenPatchingATicket_ThenUpNextFieldsCantBeSetThatWay", async () => {
    const t = await setup();
    const created = await t.create();
    await t.call(t.path(created.id), {
      method: "PATCH",
      body: JSON.stringify({ upNextRank: "0000000001" }),
    });
    expect((await t.ticket(created.id)).upNextRank).toBeNull();
    expect(await t.runs(created.id)).toEqual([]);
  });
});
