import { describe, expect, it } from "vitest";
import { Project, Question, QuotaReading, Ticket, TicketEvent } from "../entities";
import {
  RunHandle,
  RunReport,
  WorkTrackerError,
  type Executor,
  type QuotaSource,
  type RunRequest,
  type WorkTracker,
} from "../ports";

/**
 * Contract suites: every adapter for a port must pass its suite.
 * Real adapters call these from their own test files with a factory that
 * points at a sandbox (e.g., a scratch GitHub repo). Fakes run them in CI.
 */

const uniqueKey = () => `T${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

async function rejectsWith(promise: Promise<unknown>, code: WorkTrackerError["code"]) {
  await expect(promise).rejects.toMatchObject({ name: "WorkTrackerError", code });
}

/**
 * Every test makes its own project with a random key, so the suite can run against a shared
 * store (e.g. the Firestore emulator) without cleanup.
 */
export function workTrackerContract(name: string, make: () => Promise<WorkTracker>): void {
  describe(`WorkTracker contract: ${name}`, () => {
    async function setup() {
      const tracker = await make();
      const project = await tracker.createProject({ name: "Demo", key: uniqueKey() });
      const ticket = await tracker.createTicket(
        project.id,
        { type: "story", title: "First" },
        "andy",
      );
      return { tracker, project, ticket };
    }

    it("GivenANewProject_WhenCreated_ThenItIsReadableAndListed", async () => {
      const tracker = await make();
      const key = uniqueKey();
      const project = await tracker.createProject({ name: "P", key });
      expect(Project.parse(project)).toEqual(project);
      expect(project.id).toBe(key.toLowerCase());
      expect(await tracker.getProject(project.id)).toEqual(project);
      expect((await tracker.listProjects()).map((p) => p.id)).toContain(project.id);
      expect(await tracker.getProject("does-not-exist")).toBeNull();
    });

    it("GivenAnExistingKey_WhenCreatingAProject_ThenConflict", async () => {
      const { tracker, project } = await setup();
      await rejectsWith(tracker.createProject({ name: "Again", key: project.key }), "conflict");
    });

    it("GivenAProject_WhenCreatingTickets_ThenKeysIncrementInBacklogWithACreatedEvent", async () => {
      const { tracker, project, ticket } = await setup();
      const second = await tracker.createTicket(
        project.id,
        { type: "bug", title: "Second" },
        "andy",
      );
      expect(Ticket.parse(ticket)).toEqual(ticket);
      expect([ticket.key, second.key]).toEqual([`${project.key}-1`, `${project.key}-2`]);
      expect(ticket.stage).toBe("backlog");
      expect(await tracker.getTicket(project.id, ticket.id)).toEqual(ticket);
      const events = await tracker.listEvents(project.id, ticket.id);
      expect(events.map((e) => e.kind)).toEqual(["created"]);
      for (const e of events) expect(TicketEvent.parse(e)).toEqual(e);
    });

    it("GivenAnUnknownProjectOrTicket_WhenAccessed_ThenNullOrNotFound", async () => {
      const { tracker, project, ticket } = await setup();
      expect(await tracker.getTicket(project.id, "nope")).toBeNull();
      expect(await tracker.getTicket("other-project", ticket.id)).toBeNull();
      await rejectsWith(
        tracker.createTicket("nope", { type: "task", title: "x" }, "andy"),
        "not_found",
      );
      await rejectsWith(
        tracker.updateTicket(project.id, "nope", { fields: {} }, "andy"),
        "not_found",
      );
      await rejectsWith(tracker.addComment(project.id, "nope", "x", "andy"), "not_found");
      await rejectsWith(
        tracker.askQuestion(project.id, "nope", { text: "?" }, "andy"),
        "not_found",
      );
    });

    it("GivenTickets_WhenListed_ThenSortedByRankAndFilterable", async () => {
      const { tracker, project, ticket } = await setup();
      const second = await tracker.createTicket(project.id, { type: "task", title: "Two" }, "andy");
      await tracker.updateTicket(
        project.id,
        second.id,
        { stage: { to: "ready", reason: null } },
        "andy",
      );
      expect((await tracker.listTickets(project.id)).map((t) => t.id)).toEqual([
        ticket.id,
        second.id,
      ]);
      expect((await tracker.listTickets(project.id, { stage: "ready" })).map((t) => t.id)).toEqual([
        second.id,
      ]);
      await tracker.updateTicket(project.id, ticket.id, { fields: { needsYou: true } }, "system");
      expect((await tracker.listTickets(project.id, { needsYou: true })).map((t) => t.id)).toEqual([
        ticket.id,
      ]);
    });

    it("GivenFieldAndStageChanges_WhenUpdated_ThenHistoryRecordsOnlyRealChanges", async () => {
      const { tracker, project, ticket } = await setup();
      const updated = await tracker.updateTicket(
        project.id,
        ticket.id,
        {
          fields: { title: "Renamed", body: ticket.body },
          stage: { to: "ready", forced: true, reason: "why" },
        },
        "andy",
      );
      expect(updated).toMatchObject({ title: "Renamed", stage: "ready" });
      expect(await tracker.getTicket(project.id, ticket.id)).toEqual(updated);
      const events = await tracker.listEvents(project.id, ticket.id);
      expect(events.map((e) => e.kind)).toEqual(["created", "fields_changed", "stage_changed"]);
      expect(events[1]?.data).toEqual({ diff: { title: { from: "First", to: "Renamed" } } });
      expect(events[2]).toMatchObject({
        body: "why",
        data: { from: "backlog", to: "ready", forced: true },
      });
    });

    it("GivenANoOpChange_WhenUpdated_ThenNoEventAndUpdatedAtUnchanged", async () => {
      const { tracker, project, ticket } = await setup();
      const same = await tracker.updateTicket(
        project.id,
        ticket.id,
        { fields: { title: "First" } },
        "andy",
      );
      expect(same.updatedAt).toBe(ticket.updatedAt);
      expect(await tracker.listEvents(project.id, ticket.id)).toHaveLength(1);
    });

    it("GivenAStaleRead_WhenUpdatingWithIfUpdatedAt_ThenConflict", async () => {
      const { tracker, project, ticket } = await setup();
      await new Promise((r) => setTimeout(r, 5));
      await tracker.updateTicket(project.id, ticket.id, { fields: { title: "A" } }, "andy");
      await rejectsWith(
        tracker.updateTicket(
          project.id,
          ticket.id,
          { fields: { title: "B" }, ifUpdatedAt: ticket.updatedAt },
          "andy",
        ),
        "conflict",
      );
    });

    it("GivenATicket_WhenCommented_ThenACommentEventByThatActor", async () => {
      const { tracker, project, ticket } = await setup();
      const comment = await tracker.addComment(project.id, ticket.id, "hello", "agent:run-1");
      expect(comment).toMatchObject({
        kind: "comment",
        body: "hello",
        actor: "agent:run-1",
        runId: "run-1",
      });
      expect((await tracker.listEvents(project.id, ticket.id)).at(-1)).toEqual(comment);
    });

    it("GivenAQuestion_WhenAnswered_ThenStatusAndHistoryUpdateAndASecondAnswerConflicts", async () => {
      const { tracker, project, ticket } = await setup();
      const q = await tracker.askQuestion(
        project.id,
        ticket.id,
        { text: "Which?", options: ["a", "b"] },
        "system",
      );
      expect(Question.parse(q)).toEqual(q);
      expect(q).toMatchObject({ status: "open", projectId: project.id, ticketId: ticket.id });
      expect(await tracker.getQuestion(q.id)).toEqual(q);
      expect(
        (await tracker.listQuestions({ ticketId: ticket.id, status: "open" })).map((x) => x.id),
      ).toEqual([q.id]);

      const answered = await tracker.answerQuestion(q.id, "a", "ui", "andy");
      expect(answered).toMatchObject({ status: "answered", answer: "a", answeredVia: "ui" });
      expect(await tracker.listQuestions({ ticketId: ticket.id, status: "open" })).toEqual([]);
      expect((await tracker.listQuestions({ projectId: project.id })).map((x) => x.id)).toEqual([
        q.id,
      ]);
      await rejectsWith(tracker.answerQuestion(q.id, "b", "ui", "andy"), "conflict");
      await rejectsWith(tracker.answerQuestion("nope", "b", "ui", "andy"), "not_found");

      const kinds = (await tracker.listEvents(project.id, ticket.id)).map((e) => e.kind);
      expect(kinds).toEqual(["created", "question_asked", "question_answered"]);
    });
  });
}

export function executorContract(
  name: string,
  make: () => Promise<{ executor: Executor; request: (runId: string) => RunRequest }>,
): void {
  describe(`Executor contract: ${name}`, () => {
    it("starts a run and reports a valid status", async () => {
      const { executor, request } = await make();
      const handle = await executor.start(request("run-1"));
      expect(RunHandle.parse(handle).runId).toBe("run-1");
      const report = await executor.status(handle);
      expect(RunReport.parse(report).runId).toBe("run-1");
    });

    it("is idempotent by runId", async () => {
      const { executor, request } = await make();
      const a = await executor.start(request("run-2"));
      const b = await executor.start(request("run-2"));
      expect(b.externalId).toBe(a.externalId);
    });

    it("cancel leaves the run in a terminal state", async () => {
      const { executor, request } = await make();
      const handle = await executor.start(request("run-3"));
      await executor.cancel(handle);
      const { status } = await executor.status(handle);
      expect(["cancelled", "succeeded", "failed"]).toContain(status);
    });
  });
}

export function quotaSourceContract(
  name: string,
  make: () => Promise<{ source: QuotaSource; seed?: () => Promise<void> }>,
): void {
  describe(`QuotaSource contract: ${name}`, () => {
    it("returns schema-valid readings (possibly empty = unknown)", async () => {
      const { source, seed } = await make();
      await seed?.();
      const readings = await source.latest("claude-sub");
      for (const r of readings) expect(QuotaReading.parse(r)).toEqual(r);
    });
  });
}
