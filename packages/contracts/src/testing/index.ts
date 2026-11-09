import { describe, expect, it } from "vitest";
import {
  CodeHostConnection,
  CodeHostEvent,
  Project,
  Question,
  QuotaReading,
  Repo,
  RepoToken,
  Run,
  Ticket,
  TicketEvent,
} from "../entities";
import {
  OAuthGrant,
  RunHandle,
  RunReport,
  WorkTrackerError,
  type CodeEventLog,
  type CodeHost,
  type CodeHostConnectionStore,
  type Executor,
  type OAuthGrantStore,
  type QuotaStore,
  type NewRun,
  type RunRequest,
  type RunStore,
  type WatchdogQueue,
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
        { type: "feature", title: "First" },
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

    it("GivenAProject_WhenAutoRefineIsTurnedOff_ThenItIsStoredAndDefaultsOnForNewProjects", async () => {
      const tracker = await make();
      const created = await tracker.createProject({ name: "Settings", key: uniqueKey() });
      expect(created.autoRefine).toBe(true);
      const updated = await tracker.updateProject(created.id, { autoRefine: false });
      expect(updated).toEqual({ ...created, autoRefine: false });
      expect(await tracker.getProject(created.id)).toEqual(updated);
      await expect(tracker.updateProject("nope", { autoRefine: true })).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it("GivenAutoRefineOff_WhenAutoBuildIsTurnedOn_ThenAutoRefineStaysOffAndAutoBuildDefaultsOff", async () => {
      const tracker = await make();
      const created = await tracker.createProject({ name: "Build", key: uniqueKey() });
      expect(created.autoBuild).toBe(false);
      await tracker.updateProject(created.id, { autoRefine: false });
      const updated = await tracker.updateProject(created.id, { autoBuild: true });
      expect(updated).toEqual({ ...created, autoRefine: false, autoBuild: true });
      expect(await tracker.getProject(created.id)).toEqual(updated);
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

    it("GivenOnlyATitle_WhenATicketIsCreated_ThenTypeIsEmptyAndScopeListsAreEmpty", async () => {
      const { tracker, project } = await setup();
      const ticket = await tracker.createTicket(project.id, { title: "Just a title" }, "andy");
      expect(ticket).toMatchObject({ type: null, outOfScope: [], touches: [] });
      expect(await tracker.getTicket(project.id, ticket.id)).toEqual(ticket);
    });

    it("GivenATicket_WhenTypeAndScopeListsAreSet_ThenTheyAreStoredAndRecorded", async () => {
      const { tracker, project } = await setup();
      const ticket = await tracker.createTicket(project.id, { title: "Scope" }, "andy");
      const fields = {
        type: "chore" as const,
        outOfScope: ["the UI"],
        touches: ["packages/store/**"],
      };
      const updated = await tracker.updateTicket(project.id, ticket.id, { fields }, "andy");
      expect(updated).toMatchObject(fields);
      expect(await tracker.getTicket(project.id, ticket.id)).toEqual(updated);
      const events = await tracker.listEvents(project.id, ticket.id);
      expect(Object.keys(events[1]?.data.diff as object).sort()).toEqual([
        "outOfScope",
        "touches",
        "type",
      ]);
    });

    it("GivenAnArchivedTicketWithScope_WhenAnotherFieldIsEdited_ThenArchivedAndScopeStay", async () => {
      const { tracker, project, ticket } = await setup();
      const fields = { archived: true, outOfScope: ["the UI"], touches: ["apps/api/**"] };
      await tracker.updateTicket(project.id, ticket.id, { fields }, "andy");
      const edited = await tracker.updateTicket(
        project.id,
        ticket.id,
        { fields: { title: "Renamed" } },
        "andy",
      );
      expect(edited).toMatchObject({ ...fields, title: "Renamed" });
    });

    it("GivenTooManyOrTooLongScopeItems_WhenSet_ThenTheChangeIsRejected", async () => {
      const { tracker, project, ticket } = await setup();
      for (const touches of [Array(21).fill("a"), ["x".repeat(301)]]) {
        await expect(
          tracker.updateTicket(project.id, ticket.id, { fields: { touches } }, "andy"),
        ).rejects.toThrow();
      }
      expect((await tracker.getTicket(project.id, ticket.id))?.touches).toEqual([]);
    });

    it("GivenAnUnknownProjectOrTicket_WhenAccessed_ThenNullOrNotFound", async () => {
      const { tracker, project, ticket } = await setup();
      expect(await tracker.getTicket(project.id, "nope")).toBeNull();
      expect(await tracker.getTicket("other-project", ticket.id)).toBeNull();
      await rejectsWith(
        tracker.createTicket("nope", { type: "chore", title: "x" }, "andy"),
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

    it("GivenAnUpNextTicket_WhenItLeavesBacklog_ThenItsUpNextPlaceIsCleared", async () => {
      const { tracker, project: p, ticket: t } = await setup();
      expect(t.upNextRank).toBeNull();
      await tracker.updateTicket(p.id, t.id, { fields: { upNextRank: "0000000001" } }, "andy");
      const moved = await tracker.updateTicket(
        p.id,
        t.id,
        { stage: { to: "ready", forced: false, reason: null } },
        "system",
      );
      expect(moved).toMatchObject({ stage: "ready", upNextRank: null, upNextAt: null });
    });

    it("GivenAFlaggedTicket_WhenItReachesDone_ThenTheFlagIsCleared", async () => {
      const { tracker, project: p, ticket: t } = await setup();
      await tracker.updateTicket(p.id, t.id, { fields: { needsAttention: true } }, "andy");
      const done = await tracker.updateTicket(
        p.id,
        t.id,
        { stage: { to: "done", forced: true, reason: null } },
        "andy",
      );
      expect(done.needsAttention).toBe(false);
    });

    it("GivenFractionalRanks_WhenListed_ThenSortedByCodeUnitOrder", async () => {
      // Board reorders (AI-28) write ranks such as "0000000001.5"; '.' sorts before digits.
      const { tracker, project, ticket } = await setup();
      const ids = [ticket.id];
      for (const title of ["Two", "Three"]) {
        ids.push((await tracker.createTicket(project.id, { title }, "andy")).id);
      }
      const ranks = ["0000000001.5", "0000000001", "0000000001.05"];
      for (const [i, id] of ids.entries()) {
        await tracker.updateTicket(project.id, id, { fields: { rank: ranks[i] } }, "andy");
      }
      expect((await tracker.listTickets(project.id)).map((t) => t.rank)).toEqual([
        "0000000001",
        "0000000001.05",
        "0000000001.5",
      ]);
    });

    it("GivenTickets_WhenListed_ThenSortedByRankAndFilterable", async () => {
      const { tracker, project, ticket } = await setup();
      const second = await tracker.createTicket(
        project.id,
        { type: "chore", title: "Two" },
        "andy",
      );
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
      await tracker.updateTicket(
        project.id,
        ticket.id,
        { fields: { needsAttention: true } },
        "system",
      );
      expect(
        (await tracker.listTickets(project.id, { needsAttention: true })).map((t) => t.id),
      ).toEqual([ticket.id]);
    });

    it("GivenAnArchivedTicket_WhenListedByArchived_ThenOnlyMatchingTicketsAreReturned", async () => {
      const { tracker, project, ticket } = await setup();
      expect(ticket.archived).toBe(false);
      const second = await tracker.createTicket(
        project.id,
        { type: "chore", title: "Two" },
        "andy",
      );
      await tracker.updateTicket(project.id, second.id, { fields: { archived: true } }, "andy");
      const ids = async (archived?: boolean) =>
        (await tracker.listTickets(project.id, { archived })).map((t) => t.id);
      expect(await ids(true)).toEqual([second.id]);
      expect(await ids(false)).toEqual([ticket.id]);
      expect(await ids()).toEqual([ticket.id, second.id]);
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

    it("GivenATicket_WhenAPullRequestIsLinked_ThenAPrLinkedEventAndTheTicketIsUnchanged", async () => {
      const { tracker, project, ticket } = await setup();
      const link = { number: 7, url: "https://example.com/pr/7", state: "merged" } as const;
      const linked = await tracker.linkPullRequest(project.id, ticket.id, link, "system");
      expect(linked).toMatchObject({ kind: "pr_linked", actor: "system", data: link });
      expect((await tracker.listEvents(project.id, ticket.id)).at(-1)).toEqual(linked);
      expect(await tracker.getTicket(project.id, ticket.id)).toEqual(ticket);
      await rejectsWith(tracker.linkPullRequest(project.id, "nope", link, "system"), "not_found");
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

    it("GivenARunsQuestions_WhenAskedTwice_ThenTheyAreWrittenOnceWithTheRunId", async () => {
      const { tracker, project, ticket } = await setup();
      const inputs = [{ text: "Which store?", options: ["a", "b"] }, { text: "Size?" }];
      const first = await tracker.askQuestions(
        project.id,
        ticket.id,
        inputs,
        "agent:run-7",
        "run-7",
      );
      expect(first.map((q) => q.text)).toEqual(["Which store?", "Size?"]);
      for (const q of first) {
        expect(Question.parse(q)).toEqual(q);
        expect(q).toMatchObject({ status: "open", runId: "run-7", ticketId: ticket.id });
      }
      const replay = await tracker.askQuestions(
        project.id,
        ticket.id,
        inputs,
        "agent:run-7",
        "run-7",
      );
      expect(replay.map((q) => q.id).sort()).toEqual(first.map((q) => q.id).sort());
      expect(await tracker.listQuestions({ ticketId: ticket.id })).toHaveLength(2);
      const asked = (await tracker.listEvents(project.id, ticket.id)).filter(
        (e) => e.kind === "question_asked",
      );
      expect(asked.map((e) => e.actor)).toEqual(["agent:run-7", "agent:run-7"]);
    });

    it("GivenAnInvalidQuestionInTheBatch_WhenAsked_ThenNoneAreWritten", async () => {
      const { tracker, project, ticket } = await setup();
      await expect(
        tracker.askQuestions(project.id, ticket.id, [{ text: "ok" }, { text: "" }], "system"),
      ).rejects.toThrow();
      expect(await tracker.listQuestions({ ticketId: ticket.id })).toEqual([]);
      await rejectsWith(
        tracker.askQuestions(project.id, "nope", [{ text: "?" }], "system"),
        "not_found",
      );
    });

    it("GivenAnOpenQuestion_WhenWithdrawn_ThenItIsKeptAsWithdrawnAndCannotBeAnswered", async () => {
      const { tracker, project, ticket } = await setup();
      const q = await tracker.askQuestion(project.id, ticket.id, { text: "Which?" }, "system");

      const withdrawn = await tracker.withdrawQuestion(q.id, "andy");
      expect(withdrawn).toMatchObject({ id: q.id, status: "withdrawn", answer: null });
      expect(await tracker.getQuestion(q.id)).toEqual(withdrawn);
      expect(await tracker.listQuestions({ ticketId: ticket.id, status: "open" })).toEqual([]);
      await rejectsWith(tracker.withdrawQuestion(q.id, "andy"), "conflict");
      await rejectsWith(tracker.answerQuestion(q.id, "a", "ui", "andy"), "conflict");
      await rejectsWith(tracker.withdrawQuestion("nope", "andy"), "not_found");

      const kinds = (await tracker.listEvents(project.id, ticket.id)).map((e) => e.kind);
      expect(kinds).toEqual(["created", "question_asked", "question_withdrawn"]);
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

export function quotaStoreContract(name: string, make: () => Promise<QuotaStore>): void {
  describe(`QuotaStore contract: ${name}`, () => {
    const reading = (window: "5h" | "weekly", usedPct: number): QuotaReading => ({
      provider: "claude-sub",
      window,
      usedPct,
      resetsAt: "2026-11-08T17:00:00.000Z",
      source: "contract",
      takenAt: "2026-11-08T12:00:00.000Z",
      confidence: "high",
    });
    const byWindow = (a: QuotaReading, b: QuotaReading) => a.window.localeCompare(b.window);

    it("GivenTwoWindowsSaved_WhenLatestIsRead_ThenBothComeBackSchemaValid", async () => {
      const store = await make();
      const saved = [reading("5h", 10), reading("weekly", 20)];
      await store.save(saved);
      const latest = (await store.latest("claude-sub")).sort(byWindow);
      expect(latest).toEqual(saved);
      for (const r of latest) expect(QuotaReading.parse(r)).toEqual(r);
    });

    it("GivenAWindowIsSavedAgain_WhenLatestIsRead_ThenOnlyTheNewReadingRemains", async () => {
      const store = await make();
      await store.save([reading("5h", 10)]);
      await store.save([reading("5h", 55)]);
      const latest = await store.latest("claude-sub");
      expect(latest.find((r) => r.window === "5h")?.usedPct).toBe(55);
      expect(latest.filter((r) => r.window === "5h")).toHaveLength(1);
    });

    it("GivenReadingsForOneProvider_WhenAnotherIsRead_ThenItIsEmpty", async () => {
      const store = await make();
      await store.save([reading("5h", 10)]);
      expect(await store.latest("google-sub")).toEqual([]);
    });
  });
}

/**
 * `make` gets the clock the store must use, so the suite can test expiry without waiting.
 * Keys are random per test, so the suite can run against a shared store.
 */
export function oauthGrantStoreContract(
  name: string,
  make: (now: () => Date) => Promise<OAuthGrantStore>,
): void {
  describe(`OAuthGrantStore contract: ${name}`, () => {
    const start = new Date("2026-11-02T12:00:00Z");
    const key = () => crypto.randomUUID();
    const grant = (expiresAt = "2026-11-02T13:00:00Z"): OAuthGrant => ({
      kind: "code",
      clientId: "https://client.example/metadata.json",
      email: "andy@example.com",
      uid: "u1",
      resource: "https://api.example/mcp",
      scope: "mcp",
      redirectUri: "https://client.example/callback",
      codeChallenge: "challenge",
      expiresAt,
    });

    it("GivenAStoredGrant_WhenRead_ThenItIsReturnedUnchangedAndStaysStored", async () => {
      const store = await make(() => start);
      const k = key();
      await store.put(k, grant());
      const read = await store.get(k);
      expect(read).toEqual(grant());
      expect(OAuthGrant.parse(read)).toEqual(read);
      expect(await store.get(k)).toEqual(grant());
    });

    it("GivenAStoredGrant_WhenTaken_ThenItIsReturnedOnceOnly", async () => {
      const store = await make(() => start);
      const k = key();
      await store.put(k, grant());
      expect(await store.take(k)).toEqual(grant());
      expect(await store.take(k)).toBeNull();
      expect(await store.get(k)).toBeNull();
    });

    it("GivenConcurrentTakes_WhenRacing_ThenExactlyOneWins", async () => {
      const store = await make(() => start);
      const k = key();
      await store.put(k, grant());
      const results = await Promise.all([store.take(k), store.take(k), store.take(k)]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it("GivenAnExpiredGrant_WhenReadOrTaken_ThenItIsMissing", async () => {
      const store = await make(() => start);
      const k = key();
      await store.put(k, grant("2026-11-02T11:59:59Z"));
      expect(await store.get(k)).toBeNull();
      expect(await store.take(k)).toBeNull();
    });

    it("GivenAnUnknownKey_WhenRead_ThenNull", async () => {
      const store = await make(() => start);
      expect(await store.get(key())).toBeNull();
      expect(await store.take(key())).toBeNull();
    });
  });
}

/**
 * CodeHost suite. `knownRepo` must exist with the App installed; `unknownRepo` must not (or
 * not have the App). The GitHub adapter runs this against a real repo locally (ADR-0041).
 */
export function codeHostContract(
  name: string,
  make: () => Promise<{ host: CodeHost; knownRepo: string; unknownRepo: string }>,
): void {
  describe(`CodeHost contract: ${name}`, () => {
    it("GivenAnInstalledRepo_WhenRead_ThenItsCanonicalDetailsAreReturned", async () => {
      const { host, knownRepo } = await make();
      const repo = await host.getRepo(knownRepo);
      expect(repo).not.toBeNull();
      expect(Repo.parse(repo)).toEqual(repo);
      expect(repo!.fullName.toLowerCase()).toBe(knownRepo.toLowerCase());
    });

    it("GivenADifferentlyCasedName_WhenRead_ThenTheSameRepoIsReturned", async () => {
      const { host, knownRepo } = await make();
      const repo = await host.getRepo(knownRepo.toUpperCase());
      expect(repo?.fullName.toLowerCase()).toBe(knownRepo.toLowerCase());
    });

    it("GivenARepoWithoutTheApp_WhenRead_ThenNull", async () => {
      const { host, unknownRepo } = await make();
      expect(await host.getRepo(unknownRepo)).toBeNull();
    });

    it("GivenAMalformedName_WhenRead_ThenNull", async () => {
      const { host } = await make();
      expect(await host.getRepo("../etc/passwd")).toBeNull();
      expect(await host.getRepo("no-slash")).toBeNull();
    });

    it("GivenAnInstalledRepo_WhenListingInstalledRepos_ThenItIsListed", async () => {
      const { host, knownRepo } = await make();
      const repos = await host.listInstalledRepos();
      repos.forEach((r) => expect(Repo.parse(r)).toEqual(r));
      expect(repos.map((r) => r.fullName.toLowerCase())).toContain(knownRepo.toLowerCase());
    });

    it("GivenAnInstalledRepo_WhenATokenIsIssued_ThenItIsValidForAboutAnHour", async () => {
      const { host, knownRepo } = await make();
      const token = await host.issueRepoToken(knownRepo);
      expect(RepoToken.parse(token)).toEqual(token);
      const ms = Date.parse(token!.expiresAt) - Date.now();
      expect(ms).toBeGreaterThan(30 * 60 * 1000);
      expect(ms).toBeLessThanOrEqual(61 * 60 * 1000);
    });

    it("GivenARepoWithoutTheApp_WhenATokenIsRequested_ThenNull", async () => {
      const { host, unknownRepo } = await make();
      expect(await host.issueRepoToken(unknownRepo)).toBeNull();
      expect(await host.issueRepoToken("../x")).toBeNull();
    });

    it("GivenARepoWithoutTheApp_WhenAWorkflowIsDispatched_ThenNull", async () => {
      const { host, unknownRepo } = await make();
      expect(await host.dispatchWorkflow(unknownRepo, "agent-run.yml", {})).toBeNull();
      expect(await host.dispatchWorkflow("../x", "agent-run.yml", {})).toBeNull();
    });

    it("GivenAnUnknownWorkflowRun_WhenRead_ThenNull", async () => {
      const { host, knownRepo, unknownRepo } = await make();
      expect(await host.getWorkflowRun(knownRepo, "999999999999")).toBeNull();
      expect(await host.getWorkflowRun(unknownRepo, "1")).toBeNull();
    });

    it("GivenAnUnknownPullRequest_WhenRead_ThenNull", async () => {
      const { host, knownRepo, unknownRepo } = await make();
      expect(await host.getPullRequest(knownRepo, 999_999_999)).toBeNull();
      expect(await host.getPullRequest(unknownRepo, 1)).toBeNull();
    });

    it("GivenAMissingFile_WhenRead_ThenNull", async () => {
      const { host, knownRepo } = await make();
      expect(await host.readFile(knownRepo, "no/such/file.txt", "main")).toBeNull();
    });
  });
}

/** CodeHostConnectionStore suite. `make` must return an empty store each time. */
export function codeHostConnectionStoreContract(
  name: string,
  make: () => Promise<CodeHostConnectionStore>,
): void {
  describe(`CodeHostConnectionStore contract: ${name}`, () => {
    const connection = (appId = "123"): CodeHostConnection => ({
      appId,
      slug: "andy-intelligence",
      clientId: "Iv23abc",
      owner: "albernhagen",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n",
      webhookSecret: "s3cret",
      connectedAt: "2026-11-03T12:00:00.000Z",
    });

    it("GivenAnEmptyStore_WhenRead_ThenNull", async () => {
      expect(await (await make()).get()).toBeNull();
    });

    it("GivenASavedConnection_WhenRead_ThenItIsReturnedUnchanged", async () => {
      const store = await make();
      expect(await store.save(connection())).toBe("saved");
      const read = await store.get();
      expect(read).toEqual(connection());
      expect(CodeHostConnection.parse(read)).toEqual(read);
    });

    it("GivenASavedConnection_WhenSavedAgain_ThenExistsAndTheFirstStays", async () => {
      const store = await make();
      await store.save(connection());
      expect(await store.save(connection("999"))).toBe("exists");
      expect((await store.get())?.appId).toBe("123");
    });
  });
}

/** CodeEventLog suite. Every test uses fresh delivery IDs, so it can share a store. */
export function codeEventLogContract(name: string, make: () => Promise<CodeEventLog>): void {
  describe(`CodeEventLog contract: ${name}`, () => {
    const event = (deliveryId: string, title = "Add thing"): CodeHostEvent => ({
      kind: "pull_request",
      deliveryId,
      projectId: "ai",
      repo: "owner/repo",
      action: "opened",
      receivedAt: "2026-11-02T12:00:00.000Z",
      pullRequest: {
        number: 7,
        state: "open",
        draft: false,
        title,
        bodyFirstLine: "AI-7",
        fromFork: false,
        intoDefaultBranch: true,
        headRef: "m1.5/github-app",
        headSha: "abc123",
        baseRef: "main",
        url: "https://github.com/owner/repo/pull/7",
      },
    });

    it("GivenANewDelivery_WhenRecorded_ThenItIsStoredUnchanged", async () => {
      const log = await make();
      const id = crypto.randomUUID();
      expect(await log.record(event(id))).toBe("recorded");
      const read = await log.get(id);
      expect(read).toEqual(event(id));
      expect(CodeHostEvent.parse(read)).toEqual(read);
    });

    it("GivenARecordedDelivery_WhenReplayed_ThenItIsANoOpAndTheFirstRecordStays", async () => {
      const log = await make();
      const id = crypto.randomUUID();
      await log.record(event(id));
      expect(await log.record(event(id, "Changed on replay"))).toBe("duplicate");
      expect(await log.get(id)).toEqual(event(id));
    });

    it("GivenConcurrentDeliveriesWithOneId_WhenRecorded_ThenExactlyOneIsRecorded", async () => {
      const log = await make();
      const id = crypto.randomUUID();
      const results = await Promise.all([1, 2, 3].map(() => log.record(event(id))));
      expect(results.filter((r) => r === "recorded")).toHaveLength(1);
    });

    it("GivenEachEventKind_WhenRecorded_ThenItRoundTrips", async () => {
      const log = await make();
      const base = {
        projectId: "ai",
        repo: "owner/repo",
        action: "completed",
        receivedAt: "2026-11-02T12:00:00.000Z",
      };
      const check: CodeHostEvent = {
        ...base,
        kind: "check_run",
        deliveryId: crypto.randomUUID(),
        checkRun: {
          id: "1",
          name: "check",
          status: "completed",
          conclusion: "success",
          headSha: "abc123",
          url: "https://github.com/owner/repo/runs/1",
          pullRequestNumbers: [7],
        },
      };
      const workflow: CodeHostEvent = {
        ...base,
        kind: "workflow_run",
        deliveryId: crypto.randomUUID(),
        workflowRun: {
          id: "2",
          name: "CI",
          trigger: "pull_request",
          status: "completed",
          conclusion: null,
          headBranch: null,
          headSha: "abc123",
          url: "https://github.com/owner/repo/actions/runs/2",
        },
      };
      for (const e of [check, workflow]) {
        await log.record(e);
        expect(await log.get(e.deliveryId)).toEqual(e);
      }
    });

    it("GivenAnUnknownDelivery_WhenRead_ThenNull", async () => {
      const log = await make();
      expect(await log.get(crypto.randomUUID())).toBeNull();
    });
  });
}

/**
 * RunStore suite. Every test makes runs under a random project id, so it can share a store
 * (e.g. the Firestore emulator).
 */
export function runStoreContract(name: string, make: () => Promise<RunStore>): void {
  describe(`RunStore contract: ${name}`, () => {
    const newRun = (projectId: string, ticketId = "t1"): NewRun => ({
      projectId,
      ticketId,
      step: "refine",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: null,
      deadline: "2026-11-04T13:00:00.000Z",
      prompt: "Read the ticket.",
      maxTurns: 30,
    });
    const project = () => `p${crypto.randomUUID().slice(0, 8)}`;

    it("GivenANewRun_WhenCreated_ThenItIsQueuedAndReadBackUnchanged", async () => {
      const store = await make();
      const run = await store.create(newRun(project()));
      expect(Run.parse(run)).toEqual(run);
      expect(run.status).toBe("queued");
      expect(run.createdAt).not.toBeNull();
      expect(await store.get(run.id)).toEqual(run);
    });

    it("GivenACostPatch_WhenUpdated_ThenUsageAndQuotaDeltaAreStored", async () => {
      const store = await make();
      const run = await store.create(newRun(project()));
      expect(run.usage).toBeNull();
      const usage = {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        turns: 5,
        wallMs: 6,
      };
      const quotaDelta = { "5h": 1.5, weekly: null };
      await store.update(run.id, { status: "succeeded", usage, quotaDelta }, ["queued"]);
      expect(await store.get(run.id)).toMatchObject({ usage, quotaDelta });
    });

    it("GivenAnUnknownId_WhenRead_ThenNull", async () => {
      expect(await (await make()).get(crypto.randomUUID())).toBeNull();
    });

    it("GivenRunsOnTwoTickets_WhenListedForOne_ThenOnlyItsRunsNewestFirst", async () => {
      const store = await make();
      const p = project();
      const first = await store.create(newRun(p, "a"));
      await new Promise((r) => setTimeout(r, 5));
      const second = await store.create(newRun(p, "a"));
      await store.create(newRun(p, "b"));
      const ids = (await store.listForTicket(p, "a")).map((r) => r.id);
      expect(ids).toEqual([second.id, first.id]);
    });

    it("GivenQueuedAndFinishedRuns_WhenListingActive_ThenOnlyQueuedOrRunning", async () => {
      const store = await make();
      const p = project();
      const queued = await store.create(newRun(p));
      const done = await store.create(newRun(p));
      await store.update(done.id, { status: "succeeded" }, ["queued"]);
      expect((await store.listActive(p)).map((r) => r.id)).toEqual([queued.id]);
    });

    it("GivenAQueuedRun_WhenUpdatedFromQueued_ThenOnlyThePatchedFieldsChange", async () => {
      const store = await make();
      const run = await store.create(newRun(project()));
      const updated = await store.update(
        run.id,
        { status: "running", startedAt: "2026-11-04T12:01:00.000Z" },
        ["queued"],
      );
      expect(updated).toEqual({ ...run, status: "running", startedAt: "2026-11-04T12:01:00.000Z" });
      expect(await store.get(run.id)).toEqual(updated);
    });

    it("GivenAFinishedRun_WhenUpdatedFromActive_ThenConflictAndNothingChanges", async () => {
      const store = await make();
      const run = await store.create(newRun(project()));
      const done = await store.update(run.id, { status: "succeeded", summary: "ok" }, ["queued"]);
      await rejectsWith(
        store.update(run.id, { status: "failed" }, ["queued", "running"]),
        "conflict",
      );
      expect(await store.get(run.id)).toEqual(done);
    });

    it("GivenAnUnknownRun_WhenUpdated_ThenNotFound", async () => {
      const store = await make();
      await rejectsWith(
        store.update(crypto.randomUUID(), { status: "failed" }, ["queued"]),
        "not_found",
      );
    });

    it("GivenTwoConcurrentMergeClaimsOnOneHead_WhenApplied_ThenOneWinsAndANewHeadCanClaim", async () => {
      const store = await make();
      const run = await store.create(newRun(project()));
      await store.update(run.id, { status: "succeeded" }, ["queued"]);
      const results = await Promise.allSettled([
        store.update(run.id, { mergeAttemptedSha: "a" }, ["succeeded"]),
        store.update(run.id, { mergeAttemptedSha: "a" }, ["succeeded"]),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const next = await store.update(run.id, { mergeAttemptedSha: "b" }, ["succeeded"]);
      expect(next.mergeAttemptedSha).toBe("b");
    });

    it("GivenTwoConcurrentPlanDecisions_WhenApplied_ThenExactlyOneWinsAndIsKept", async () => {
      const store = await make();
      const run = await store.create({ ...newRun(project()), step: "plan" });
      await store.update(run.id, { status: "succeeded" }, ["queued"]);
      const decision = (d: "approved" | "rejected") => ({
        decision: d,
        reason: d === "rejected" ? "no" : null,
        by: "andy@example.com",
        at: "2026-11-06T12:00:00.000Z",
      });
      const results = await Promise.allSettled([
        store.update(run.id, { planDecision: decision("approved") }, ["succeeded"]),
        store.update(run.id, { planDecision: decision("rejected") }, ["succeeded"]),
      ]);
      const won = results.filter((r) => r.status === "fulfilled");
      expect(won).toHaveLength(1);
      const kept = (won[0] as PromiseFulfilledResult<Run>).value.planDecision;
      expect((await store.get(run.id))!.planDecision).toEqual(kept);
      await rejectsWith(
        store.update(run.id, { planDecision: decision("rejected") }, ["succeeded"]),
        "conflict",
      );
    });

    it("GivenTwoConcurrentUpdatesFromQueued_WhenApplied_ThenExactlyOneWins", async () => {
      const store = await make();
      const run = await store.create(newRun(project()));
      const results = await Promise.allSettled([
        store.update(run.id, { status: "succeeded" }, ["queued"]),
        store.update(run.id, { status: "failed" }, ["queued"]),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
  });
}

export function watchdogQueueContract(name: string, make: () => Promise<WatchdogQueue>): void {
  describe(`WatchdogQueue contract: ${name}`, () => {
    const runId = () => `run-${crypto.randomUUID()}`;
    const at = "2026-11-04T13:00:00.000Z";

    it("GivenANewRun_WhenScheduled_ThenScheduled", async () => {
      expect(await (await make()).schedule({ runId: runId(), at })).toBe("scheduled");
    });

    it("GivenAScheduledRun_WhenScheduledAgain_ThenDuplicate", async () => {
      const queue = await make();
      const id = runId();
      await queue.schedule({ runId: id, at });
      expect(await queue.schedule({ runId: id, at: "2026-11-04T14:00:00.000Z" })).toBe("duplicate");
    });

    it("GivenAnInvalidRunId_WhenScheduled_ThenRejected", async () => {
      await expect((await make()).schedule({ runId: "a/b", at })).rejects.toThrow();
    });
  });
}
