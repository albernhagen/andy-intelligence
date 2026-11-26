import {
  DEPLOYMENT_LIMITS,
  InMemoryCodeHost,
  InMemoryDeploymentStore,
  InMemoryReleaseNoteStore,
  InMemoryWorkTracker,
  type CommitRange,
  type Deployment,
  type Project,
  type ReleaseEntry,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReleaseNote } from "./release-notes";
import {
  ReleaseReader,
  epicLookup,
  previousSucceeded,
  prNumberFromCommitTitle,
  releaseEntries,
  releaseNotesFor,
  renderReleaseText,
} from "./releases";

const REPO = "albernhagen/andy-intelligence";
const REPO_URL = `https://github.com/${REPO}`;
const sha = (c: string) => c.repeat(40);
const DIGEST = `sha256:${"e".repeat(64)}`;

const note = (n: number, opts: { ticketKey?: string | null; block?: boolean } = {}) =>
  buildReleaseNote({
    projectId: "ai",
    pr: { number: n, url: `${REPO_URL}/pull/${n}`, title: `PR ${n} title` },
    details: {
      body: opts.block === false ? "" : `What changed: Change ${n}.\nHow it works: Code.`,
      mergedBy: null,
      mergedAt: "2026-11-20T10:00:00.000Z",
    },
    ticket: opts.ticketKey ? { key: opts.ticketKey, title: "x", risk: null } : null,
    files: [],
    recordedAt: "2026-11-20T10:00:00.000Z",
  });

const range = (titles: string[], complete = true): CommitRange => ({
  status: "ahead",
  commits: {
    items: titles.map((title, i) => ({ sha: sha(String(i + 1)), title })),
    complete,
  },
});

const ticket = (n: number, overrides: Partial<Ticket> = {}): Ticket =>
  ({
    id: `t-${n}`,
    key: `AI-${n}`,
    title: `T${n}`,
    type: "feature",
    parentId: null,
    ...overrides,
  }) as Ticket;

describe("prNumberFromCommitTitle", () => {
  it("GivenASquashTitle_WhenParsed_ThenTheTrailingPrNumber", () => {
    expect(prNumberFromCommitTitle("AI-201: M6.16: Project environment module (#436)")).toBe(436);
  });

  it("GivenATitleNamingAnotherPrInside_WhenParsed_ThenOnlyTheTrailingOneCounts", () => {
    expect(prNumberFromCommitTitle("Revert (#12) fix (#40)")).toBe(40);
    expect(prNumberFromCommitTitle("Follow-up to (#12) in main")).toBeNull();
  });

  it("GivenADirectPush_WhenParsed_ThenNull", () => {
    expect(prNumberFromCommitTitle("Bump version")).toBeNull();
  });
});

describe("previousSucceeded", () => {
  const dep = (id: string, startedAt: string, status: Deployment["status"]): Deployment => ({
    id,
    projectId: "ai",
    environment: "prod",
    imageDigest: DIGEST,
    gitSha: sha("a"),
    revision: null,
    kind: "deploy",
    status,
    startedAt,
    finishedAt: status === "started" ? null : startedAt,
    actor: "system",
    previousDeploymentId: null,
    url: null,
    request: null,
  });
  const target = dep("t", "2026-11-20T12:00:00.000Z", "succeeded");

  it("GivenOlderDeployments_WhenSearched_ThenTheNewestSucceededOneBeforeTheTarget", () => {
    const recent = [
      dep("newer", "2026-11-21T00:00:00.000Z", "succeeded"),
      target,
      dep("failed", "2026-11-20T11:00:00.000Z", "failed"),
      dep("good", "2026-11-20T10:00:00.000Z", "succeeded"),
      dep("older", "2026-11-19T10:00:00.000Z", "succeeded"),
    ];
    expect(previousSucceeded(target, recent)).toEqual({ found: recent[3] });
  });

  it("GivenNoEarlierSucceededDeployment_WhenSearched_ThenNone", () => {
    expect(previousSucceeded(target, [target])).toEqual({ found: null, reason: "none" });
  });

  it("GivenAFullPageWithoutOne_WhenSearched_ThenBeyondTheCap", () => {
    const page = Array.from({ length: DEPLOYMENT_LIMITS.maxPage }, (_, i) =>
      dep(`f${i}`, "2026-11-20T11:00:00.000Z", "failed"),
    );
    expect(previousSucceeded(target, page)).toEqual({ found: null, reason: "beyond_cap" });
  });
});

describe("releaseNotesFor", () => {
  const tickets = [
    ticket(1, { type: "epic", title: "M6: Dev → prod releases" }),
    ticket(2, { type: "epic", title: "M4: Night" }),
    ticket(10, { parentId: "t-1" }),
    ticket(20, { parentId: "t-2" }),
    ticket(30),
  ];

  it("GivenPrsUnderSeveralEpics_WhenBuilt_ThenOneLinePerPrInMergeOrderGroupedByEpic", () => {
    const notes = new Map([
      [1, note(1, { ticketKey: "AI-10" })],
      [2, note(2, { ticketKey: "AI-20" })],
      [3, note(3, { ticketKey: "AI-10" })],
      [4, note(4, { ticketKey: "AI-30" })],
    ]);
    const entries = releaseEntries(range(["a (#1)", "b (#2)", "c (#3)", "d (#4)"]), notes);
    const groups = releaseNotesFor(entries, epicLookup(tickets));
    expect(groups.map((g) => [g.epicKey, g.lines.map((l) => l.text)])).toEqual([
      ["AI-1", ["Change 1.", "Change 3."]],
      ["AI-2", ["Change 2."]],
      [null, ["Change 4."]],
    ]);
    expect(groups[0]!.lines[0]).toEqual({
      prNumber: 1,
      prUrl: `${REPO_URL}/pull/1`,
      sha: sha("1"),
      text: "Change 1.",
      noNote: false,
    });
  });

  it("GivenAPrWithoutAStoredNote_WhenBuilt_ThenItsTitleMarkedNoNote", () => {
    const notes = new Map([[2, note(2, { block: false })]]);
    const entries = releaseEntries(range(["Missing (#1)", "Blockless (#2)", "Direct"]), notes);
    const lines = releaseNotesFor(entries, () => null).flatMap((g) => g.lines);
    expect(lines.map((l) => [l.text, l.noNote])).toEqual([
      ["Missing (#1) (no note)", true],
      ["PR 2 title (no note)", true],
      ["Direct (no PR)", true],
    ]);
  });

  it("GivenNoteTextWithMarkup_WhenBuilt_ThenItStaysPlainTextUnchanged", () => {
    const entry: ReleaseEntry = {
      sha: sha("1"),
      commitTitle: "x (#1)",
      prNumber: 1,
      note: { ...note(1), whatChanged: "<script>x</script> [link](javascript:y)" },
    };
    const [group] = releaseNotesFor([entry], () => null);
    expect(group!.lines[0]!.text).toBe("<script>x</script> [link](javascript:y)");
  });

  it("GivenTheSameInput_WhenBuiltTwice_ThenTheOutputIsIdentical", () => {
    const notes = new Map([[1, note(1, { ticketKey: "AI-10" })]]);
    const build = () =>
      JSON.stringify(
        releaseNotesFor(releaseEntries(range(["a (#1)", "b"]), notes), epicLookup(tickets)),
      );
    expect(build()).toBe(build());
  });
});

describe("ReleaseReader", () => {
  let tracker: InMemoryWorkTracker;
  let project: Project;
  let deployments: InMemoryDeploymentStore;
  let host: InMemoryCodeHost;
  let notes: InMemoryReleaseNoteStore;
  let reader: ReleaseReader;

  const deploy = async (gitSha: string, startedAt: string, status: "succeeded" | "failed") => {
    const d = await deployments.record({
      projectId: project.id,
      environment: "prod",
      imageDigest: DIGEST,
      gitSha,
      kind: "deploy",
      status: "started",
      startedAt,
      actor: "system",
    });
    return deployments.finish(d.id, { status, finishedAt: startedAt });
  };

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    project = await tracker.createProject({ name: "AI", key: "AI", repos: [REPO] });
    deployments = new InMemoryDeploymentStore();
    host = new InMemoryCodeHost([
      { fullName: REPO, defaultBranch: "main", private: false, url: REPO_URL },
    ]);
    notes = new InMemoryReleaseNoteStore();
    reader = new ReleaseReader(deployments, host, notes, tracker);
  });

  it("GivenTwoSucceededDeployments_WhenRead_ThenThePrsBetweenWithNotesInMergeOrder", async () => {
    const epic = await tracker.createTicket(
      project.id,
      { type: "epic", title: "M6: Dev → prod releases" },
      "system",
    );
    const story = await tracker.createTicket(
      project.id,
      { type: "feature", title: "Story", parentId: epic.id },
      "system",
    );
    await notes.put({ ...note(7, { ticketKey: story.key }), projectId: project.id });
    await notes.put({ ...note(8), projectId: project.id });
    const prev = await deploy(sha("a"), "2026-11-20T10:00:00.000Z", "succeeded");
    await deploy(sha("f"), "2026-11-20T11:00:00.000Z", "failed");
    const current = await deploy(sha("b"), "2026-11-20T12:00:00.000Z", "succeeded");
    host.commitRanges.set(
      `${sha("a")}...${sha("b")}`,
      range(["Story (#7)", "Other (#8)", "No note (#9)"]),
    );

    const release = await reader.read(project.id, current.id);

    expect(release.status).toBe("listed");
    expect(release.previous).toEqual({ deploymentId: prev.id, gitSha: sha("a") });
    expect(release.entries.map((e) => [e.prNumber, e.note?.prNumber ?? null])).toEqual([
      [7, 7],
      [8, 8],
      [9, null],
    ]);
    expect(release.groups.map((g) => [g.epicKey, g.lines.map((l) => l.text)])).toEqual([
      [epic.key, ["Change 7."]],
      [null, ["Change 8.", "No note (#9) (no note)"]],
    ]);
    expect(release.truncated).toBe(false);
    const text = renderReleaseText(release);
    expect(text).toContain(`${epic.key}: M6: Dev → prod releases\n- Change 7. · PR #7`);
    expect(text).toContain("- No note (#9) (no note) · PR #9");
  });

  it("GivenNoEarlierSucceededDeployment_WhenRead_ThenFirstWithASingleLine", async () => {
    const only = await deploy(sha("b"), "2026-11-20T12:00:00.000Z", "succeeded");
    const release = await reader.read(project.id, only.id);
    expect(release).toMatchObject({ status: "first", previous: null, entries: [] });
    expect(renderReleaseText(release).split("\n")).toHaveLength(2);
  });

  it("GivenTheSameCommitRedeployed_WhenRead_ThenSameCommitWithoutACodeHostRead", async () => {
    await deploy(sha("a"), "2026-11-20T10:00:00.000Z", "succeeded");
    const again = await deploy(sha("a"), "2026-11-20T12:00:00.000Z", "succeeded");
    const spy = vi.spyOn(host, "listCommitsBetween");
    expect((await reader.read(project.id, again.id)).status).toBe("same_commit");
    expect(spy).not.toHaveBeenCalled();
  });

  it("GivenARollbackToAnOlderCommit_WhenRead_ThenNotAhead", async () => {
    await deploy(sha("b"), "2026-11-20T10:00:00.000Z", "succeeded");
    const back = await deploy(sha("a"), "2026-11-20T12:00:00.000Z", "succeeded");
    host.commitRanges.set(`${sha("b")}...${sha("a")}`, {
      status: "behind",
      commits: { items: [], complete: true },
    });
    const release = await reader.read(project.id, back.id);
    expect(release.status).toBe("not_ahead");
    expect(renderReleaseText(release)).toContain("a rollback");
  });

  it("GivenMoreCommitsThanTheCap_WhenRead_ThenTruncated", async () => {
    await deploy(sha("a"), "2026-11-20T10:00:00.000Z", "succeeded");
    const current = await deploy(sha("b"), "2026-11-20T12:00:00.000Z", "succeeded");
    host.commitRanges.set(`${sha("a")}...${sha("b")}`, range(["x (#1)"], false));
    const release = await reader.read(project.id, current.id);
    expect(release.truncated).toBe(true);
    expect(renderReleaseText(release)).toContain("The commit cap was reached");
  });

  it("GivenTheCodeHostCannotCompare_WhenRead_ThenUnavailableWithAReason", async () => {
    await deploy(sha("a"), "2026-11-20T10:00:00.000Z", "succeeded");
    const current = await deploy(sha("b"), "2026-11-20T12:00:00.000Z", "succeeded");
    const unknown = await reader.read(project.id, current.id);
    expect(unknown).toMatchObject({ status: "unavailable", entries: [] });
    expect(unknown.reason).toMatch(/does not know/);

    vi.spyOn(host, "listCommitsBetween").mockRejectedValue(new Error("rate limited"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await reader.read(project.id, current.id);
    expect(failed.reason).toBe("the code host read failed");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("rate limited"));
    expect(renderReleaseText(failed)).toContain("could not be read: the code host read failed");
  });

  it("GivenADeploymentOfAnotherProject_WhenRead_ThenNotFound", async () => {
    const current = await deploy(sha("b"), "2026-11-20T12:00:00.000Z", "succeeded");
    await expect(reader.read("other", current.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(reader.read(project.id, "nope")).rejects.toMatchObject({ code: "not_found" });
  });
});
