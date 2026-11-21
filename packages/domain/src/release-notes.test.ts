import {
  InMemoryCodeHost,
  InMemoryReleaseNoteStore,
  InMemoryWorkTracker,
  type CodeHostEvent,
  type Project,
  type PullRequest,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReleaseNoteRecorder,
  WhatsNewReader,
  buildReleaseNote,
  milestoneStatus,
  releaseNoteLinks,
  renderWhatsNewText,
  repoUrlOf,
  whatsNewWindow,
} from "./release-notes";

const REPO = "albernhagen/andy-intelligence";
const REPO_URL = `https://github.com/${REPO}`;
const NOW = new Date("2026-11-20T12:00:00.000Z");
const BLOCK = "https://x/p/ai/t/AI-1\n\nWhat changed: Andy sees a page.\nHow it works: A route.";

const pr = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  number: 70,
  state: "merged",
  draft: false,
  title: "AI-1: something",
  bodyFirstLine: "",
  fromFork: false,
  intoDefaultBranch: true,
  headRef: "AI-1/something",
  headSha: "abc",
  baseRef: "main",
  url: `${REPO_URL}/pull/70`,
  ...overrides,
});

const merged = (overrides: Partial<PullRequest> = {}, action = "closed"): CodeHostEvent => ({
  kind: "pull_request",
  deliveryId: "d-1",
  projectId: "ai",
  repo: REPO,
  action,
  receivedAt: NOW.toISOString(),
  pullRequest: pr(overrides),
});

describe("releaseNoteLinks", () => {
  it("GivenDocsAndCode_WhenLinked_ThenFeatureAdrRunbookInOrderAndIndexesSkipped", () => {
    const links = releaseNoteLinks(
      [
        { path: "docs/runbooks/whats-new.md" },
        { path: "apps/api/src/app.ts" },
        { path: "docs/architecture/adr/0121-release-notes.md" },
        { path: "docs/features/whats-new.md" },
        { path: "docs/features/README.md" },
        { path: "docs/architecture/adr/README.md" },
      ],
      REPO_URL,
    );
    expect(links.map((l) => l.kind)).toEqual(["feature", "adr", "runbook"]);
    expect(links[0]?.url).toBe(`${REPO_URL}/blob/HEAD/docs/features/whats-new.md`);
  });

  it("GivenManyDocs_WhenLinked_ThenCappedAtTen", () => {
    const files = Array.from({ length: 15 }, (_, i) => ({ path: `docs/runbooks/r${i}.md` }));
    expect(releaseNoteLinks(files, REPO_URL)).toHaveLength(10);
  });

  it("GivenAUrlThatIsNotAPr_WhenRepoRead_ThenNull", () => {
    expect(repoUrlOf(`${REPO_URL}/pull/7`)).toBe(REPO_URL);
    expect(repoUrlOf("https://example.com/x")).toBeNull();
  });
});

describe("buildReleaseNote", () => {
  const input = (body: string) => ({
    projectId: "ai",
    pr: { number: 70, url: `${REPO_URL}/pull/70`, title: "AI-1: something" },
    details: { body, mergedBy: "albernhagen", mergedAt: "2026-11-20T10:00:00.000Z" },
    ticket: { key: "AI-1", title: "Something", risk: "low" as const },
    files: [],
    recordedAt: NOW.toISOString(),
  });

  it("GivenABlock_WhenBuilt_ThenANoteWithItsFields", () => {
    expect(buildReleaseNote(input(BLOCK))).toMatchObject({
      id: "pr-70",
      source: "note",
      whatChanged: "Andy sees a page.",
      howItWorks: "A route.",
      needsYou: null,
      ticketKey: "AI-1",
      risk: "low",
      mergedBy: "albernhagen",
      mergedAt: "2026-11-20T10:00:00.000Z",
    });
  });

  it("GivenNoBlock_WhenBuilt_ThenNoNoteWithTheTitleKept", () => {
    expect(buildReleaseNote(input("## Summary\nStuff."))).toMatchObject({
      source: "no_note",
      whatChanged: null,
      prTitle: "AI-1: something",
    });
  });

  it("GivenNoBlockAndABackfillSentence_WhenBuilt_ThenBackfilled", () => {
    const note = buildReleaseNote({
      ...input("Stuff."),
      fallback: { source: "backfill", whatChanged: "Stuff." },
    });
    expect(note).toMatchObject({ source: "backfill", whatChanged: "Stuff.", howItWorks: null });
  });
});

describe("ReleaseNoteRecorder", () => {
  let tracker: InMemoryWorkTracker;
  let host: InMemoryCodeHost;
  let notes: InMemoryReleaseNoteStore;
  let project: Project;
  let recorder: ReleaseNoteRecorder;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    host = new InMemoryCodeHost([
      { fullName: REPO, defaultBranch: "main", private: false, url: REPO_URL },
    ]);
    notes = new InMemoryReleaseNoteStore();
    project = await tracker.createProject({ name: "AI", key: "AI" });
    await tracker.createTicket(project.id, { type: "feature", title: "Something" }, "system");
    recorder = new ReleaseNoteRecorder(host, tracker, notes, () => NOW);
    host.pullRequests.set(70, {
      pullRequest: pr(),
      files: { items: [{ path: "docs/features/x.md", previousPath: null }], complete: true },
      checks: { items: [], complete: true },
      commits: { items: [], complete: true },
      details: { body: BLOCK, mergedBy: "albernhagen", mergedAt: "2026-11-20T10:00:00.000Z" },
    });
  });

  it("GivenAMergeIntoTheDefaultBranch_WhenRecorded_ThenTheNoteIsStoredWithTicketAndLinks", async () => {
    expect(await recorder.record(merged(), project)).toEqual({
      result: "recorded",
      source: "note",
      ticket: "AI-1",
    });
    const note = await notes.get(project.id, "pr-70");
    expect(note).toMatchObject({ ticketTitle: "Something", whatChanged: "Andy sees a page." });
    expect(note?.links.map((l) => l.path)).toEqual(["docs/features/x.md"]);
  });

  it("GivenAPrThatIsNotAMergeIntoTheDefaultBranch_WhenRecorded_ThenNothingStored", async () => {
    expect(await recorder.record(merged({ state: "open" }, "opened"), project)).toMatchObject({
      result: "ignored",
      reason: "not_merged",
    });
    expect(await recorder.record(merged({ intoDefaultBranch: false }), project)).toMatchObject({
      reason: "not_merged",
    });
    expect(await recorder.record(merged({ fromFork: true }), project)).toMatchObject({
      reason: "fork",
    });
    expect(await notes.listForProject(project.id)).toEqual([]);
  });

  it("GivenAPrWithNoTicketKey_WhenRecorded_ThenStoredWithoutTicket", async () => {
    await recorder.record(merged({ headRef: "chore/x" }), project);
    expect(await notes.get(project.id, "pr-70")).toMatchObject({ ticketKey: null, risk: null });
  });

  it("GivenTheHostReadsFail_WhenRecorded_ThenListedByTitleAsNoNoteWithTheError", async () => {
    vi.spyOn(host, "getPullRequestDetails").mockRejectedValue(new Error("502 Bad Gateway"));
    expect(await recorder.record(merged(), project)).toEqual({
      result: "recorded",
      source: "no_note",
      ticket: "AI-1",
      readError: "502 Bad Gateway",
    });
    expect(await notes.get(project.id, "pr-70")).toMatchObject({ source: "no_note", links: [] });
  });

  it("GivenThePrIsUnknownToTheHost_WhenRecorded_ThenListedByTitleAsNoNote", async () => {
    host.pullRequests.clear();
    expect(await recorder.record(merged(), project)).toMatchObject({ source: "no_note" });
    expect(await notes.get(project.id, "pr-70")).toMatchObject({
      prTitle: "AI-1: something",
      mergedAt: NOW.toISOString(),
      whatChanged: null,
    });
  });
});

describe("whatsNewWindow", () => {
  it("GivenNothing_WhenComputed_ThenTheLast14Days", () => {
    const w = whatsNewWindow(NOW);
    expect(w.to).toEqual(NOW);
    expect(w.from.toISOString()).toBe("2026-11-06T12:00:00.000Z");
  });

  it("GivenASinceBeyond90DaysAndAFutureUntil_WhenComputed_ThenClamped", () => {
    const w = whatsNewWindow(NOW, "2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z");
    expect(w.to).toEqual(NOW);
    expect(w.from.toISOString()).toBe("2026-08-22T12:00:00.000Z");
  });
});

describe("milestoneStatus and WhatsNewReader", () => {
  let tracker: InMemoryWorkTracker;
  let project: Project;
  let base: Ticket;

  const ticket = (n: number, overrides: Partial<Ticket>): Ticket => ({
    ...base,
    id: `t-${n}`,
    key: `AI-${n}`,
    title: `T${n}`,
    rank: String(n).padStart(4, "0"),
    ...overrides,
  });

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    project = await tracker.createProject({ name: "AI", key: "AI" });
    base = await tracker.createTicket(project.id, { type: "feature", title: "x" }, "system");
  });

  const tickets = () => [
    ticket(2, { type: "epic", parentId: null, title: "M2" }),
    ticket(1, { type: "epic", parentId: null, title: "M1" }),
    ticket(10, { parentId: "t-1", stage: "done" }),
    ticket(11, { parentId: "t-1", stage: "done", archived: true }),
    ticket(20, { parentId: "t-2", stage: "ready_for_review" }),
    ticket(21, { parentId: "t-2", stage: "in_progress", needsAttention: true }),
    ticket(22, { parentId: "t-2", stage: "backlog" }),
    ticket(23, { parentId: "t-2", stage: "cancelled" }),
    ticket(3, { type: "epic", parentId: "t-2", title: "Sub" }),
    ticket(30, { parentId: "t-3", stage: "ready" }),
    ticket(40, { parentId: null, stage: "done" }),
  ];

  it("GivenEpicsAndStories_WhenCounted_ThenPerTopLevelEpicInRankOrder", () => {
    expect(milestoneStatus(tickets())).toEqual([
      { key: "AI-1", title: "M1", done: 2, inReview: 0, inProgress: 0, notStarted: 0, needsYou: 0 },
      { key: "AI-2", title: "M2", done: 0, inReview: 1, inProgress: 1, notStarted: 2, needsYou: 1 },
    ]);
  });

  it("GivenNotesInTheWindow_WhenRead_ThenStatusNeedsYouAndNotesWithEpics", async () => {
    vi.spyOn(tracker, "listTickets").mockResolvedValue(tickets());
    const notes = new InMemoryReleaseNoteStore();
    const note = (n: number, ticketKey: string | null, mergedAt: string) =>
      buildReleaseNote({
        projectId: project.id,
        pr: { number: n, url: `${REPO_URL}/pull/${n}`, title: `PR ${n}` },
        details: { body: n === 2 ? "" : BLOCK, mergedBy: null, mergedAt },
        ticket: ticketKey ? { key: ticketKey, title: "x", risk: null } : null,
        files: [],
        recordedAt: mergedAt,
      });
    await notes.put(note(1, "AI-30", "2026-11-19T10:00:00.000Z"));
    await notes.put(note(2, null, "2026-11-20T10:00:00.000Z"));
    await notes.put(note(3, "AI-10", "2026-10-01T10:00:00.000Z"));
    const reader = new WhatsNewReader(tracker, notes);
    const w = await reader.read(project.id, whatsNewWindow(NOW));
    expect(w.notes.map((n) => [n.prNumber, n.epicKey])).toEqual([
      [2, null],
      [1, "AI-2"],
    ]);
    expect(w.needsYou).toEqual({ count: 1, tickets: [{ key: "AI-21", title: "T21" }] });
    expect(w.truncated).toBe(false);
    const filtered = await reader.read(project.id, whatsNewWindow(NOW), "AI-2");
    expect(filtered.notes.map((n) => n.prNumber)).toEqual([1]);
    const text = renderWhatsNewText(w);
    expect(text).toContain(
      "- AI-2: M2 · 0 done, 1 in review, 1 in progress, 2 not started · 1 need you",
    );
    expect(text).toContain("- Done: AI-1: M1");
    expect(text).toContain("PR 2 (no note) · no ticket · PR #2");
  });

  it("GivenAnUnknownProject_WhenRead_ThenNotFound", async () => {
    const reader = new WhatsNewReader(tracker, new InMemoryReleaseNoteStore());
    await expect(reader.read("nope", whatsNewWindow(NOW))).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
