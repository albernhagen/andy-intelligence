import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMMENT_MARKER,
  MAX_FILES_NAMED,
  MAX_PRS_PER_RUN,
  MAX_RUNS_PER_HOUR,
  OPT_OUT_LABEL,
  conflictFiles,
  gitRunner,
  mergeMessage,
  pickPrs,
  resync,
  skipReason,
  stopComment,
  summaryTable,
  workflowFile,
} from "./resync-prs.mjs";

const REPO = "o/r";
const MAIN = "a".repeat(40);
const HEAD = "b".repeat(40);
const ACTOR = "ctl-app[bot]";
const ctx = { repo: REPO, defaultBranch: "main" };

const pr = (over = {}) => ({
  number: 7,
  draft: false,
  updated_at: "2026-11-20T10:00:00Z",
  labels: [],
  user: { login: "albernhagen" },
  base: { ref: "main" },
  head: { ref: "ai-1/thing", sha: HEAD, repo: { full_name: REPO } },
  ...over,
});

const env = {
  REPO,
  DEFAULT_BRANCH: "main",
  READ_TOKEN: "read-token",
  WORKFLOW_REF: `${REPO}/.github/workflows/resync-prs.yml@refs/heads/main`,
  CONTROL_PLANE_URL: "https://cp.example",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example/?x=1",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request",
};

/**
 * A fake world: `git` answers by subcommand, `github` records calls and answers by route,
 * `fetchImpl` stands in for the OIDC and control-plane token requests.
 */
function world({
  prs = [pr()],
  runsLastHour = 1,
  ancestor = 1,
  recentMerges = 0,
  mergeTree = { status: 0, stdout: "tree\n" },
  fetchStatus = 0,
  fetchedHead = HEAD,
  comments = [],
  update = { status: 202, data: {} },
  token = { status: 200, body: { token: "write-token", actor: ACTOR } },
} = {}) {
  const calls = [];
  const gitCalls = [];
  let lastFetch = "";
  const git = (args) => {
    gitCalls.push(args);
    switch (args[0]) {
      case "fetch":
        lastFetch = args.at(-1);
        return { status: fetchStatus, stdout: "", stderr: "" };
      case "rev-parse":
        return {
          status: 0,
          stdout: `${lastFetch.startsWith("refs/heads/") ? MAIN : fetchedHead}\n`,
        };
      case "merge-base":
        return { status: ancestor, stdout: "" };
      case "rev-list":
        return { status: 0, stdout: `${recentMerges}\n` };
      case "merge-tree":
        return mergeTree;
      default:
        throw new Error(`unexpected git ${args[0]}`);
    }
  };
  const github = async (method, path, opts = {}) => {
    calls.push({ method, path, token: opts.token, body: opts.body });
    if (path.includes("/actions/workflows/"))
      return { status: 200, data: { total_count: runsLastHour } };
    if (method === "GET" && path.includes("/pulls?")) return { status: 200, data: prs };
    if (method === "GET" && path.includes("/comments")) return { status: 200, data: comments };
    if (path.endsWith("/update-branch")) return update;
    return { status: method === "POST" ? 201 : 200, data: {} };
  };
  const fetchImpl = async (url) => {
    calls.push({ method: "FETCH", path: url });
    if (new URL(url).host === "oidc.example") {
      return { ok: true, status: 200, json: async () => ({ value: "oidc-jwt" }) };
    }
    return { ok: token.status === 200, status: token.status, json: async () => token.body };
  };
  const lines = [];
  const self = { github };
  const run = () =>
    resync({
      env,
      git,
      github: (...args) => self.github(...args),
      fetchImpl,
      emit: (l) => lines.push(l),
      now: () => new Date("2026-11-20T12:00:00Z"),
    });
  return Object.assign(self, { run, calls, gitCalls, lines });
}

const writes = (calls) => calls.filter((c) => ["PUT", "POST", "PATCH"].includes(c.method));

describe("skipReason", () => {
  it("GivenAnOrdinarySameRepoPr_WhenChecked_ThenEligible", () => {
    expect(skipReason(pr(), ctx)).toBeNull();
  });

  it.each([
    ["fork", pr({ head: { ref: "x", sha: HEAD, repo: { full_name: "evil/r" } } }), "fork"],
    ["draft", pr({ draft: true }), "draft"],
    ["opt-out label", pr({ labels: [{ name: OPT_OUT_LABEL }] }), OPT_OUT_LABEL],
    [
      "agent branch",
      pr({ head: { ref: "agent/AI-1/run", sha: HEAD, repo: { full_name: REPO } } }),
      "agent",
    ],
    ["Dependabot", pr({ user: { login: "dependabot[bot]" } }), "Dependabot"],
    ["other base", pr({ base: { ref: "epic/AI-2" } }), "another branch"],
    ["deleted head repo", pr({ head: { ref: "x", sha: HEAD, repo: null } }), "fork"],
  ])("Given%s_WhenChecked_ThenSkipped", (_name, input, reason) => {
    expect(skipReason(input, ctx)).toContain(reason);
  });
});

describe("pickPrs", () => {
  it("GivenMorePrsThanTheCap_WhenPicked_ThenLeastRecentlyUpdatedFirstAndRestDeferred", () => {
    const prs = Array.from({ length: MAX_PRS_PER_RUN + 2 }, (_, i) =>
      pr({ number: i + 1, updated_at: `2026-11-${String(30 - i).padStart(2, "0")}T00:00:00Z` }),
    );
    const { candidates, skipped } = pickPrs(prs, ctx);
    expect(candidates).toHaveLength(MAX_PRS_PER_RUN);
    expect(candidates[0].number).toBe(MAX_PRS_PER_RUN + 2);
    expect(skipped.map((s) => s.number)).toEqual([2, 1]);
    expect(skipped[0].detail).toContain("cap");
  });
});

describe("workflowFile", () => {
  it("GivenAWorkflowRef_WhenParsed_ThenTheFileName", () => {
    expect(workflowFile(env.WORKFLOW_REF)).toBe("resync-prs.yml");
  });

  it("GivenGarbage_WhenParsed_ThenThrows", () => {
    expect(() => workflowFile("o/r/../x.yml@main")).toThrow();
  });
});

describe("conflictFiles and stopComment", () => {
  it("GivenMergeTreeOutput_WhenParsed_ThenFilesAfterTheTreeLine", () => {
    expect(conflictFiles("tree\nREADME.md\ndocs/a.md\nREADME.md\n")).toEqual([
      "README.md",
      "docs/a.md",
    ]);
  });

  it("GivenHostileFileNames_WhenCommented_ThenEachIsOneLineOfInlineCode", () => {
    const body = stopComment({
      headSha: HEAD,
      mainSha: MAIN,
      defaultBranch: "main",
      files: ["a`b\n@everyone", "c.md"],
      reason: "merging it conflicts.",
    });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("- `a b @everyone`");
    expect(body).toContain("- `c.md`");
  });

  it("GivenManyFiles_WhenCommented_ThenCappedWithACount", () => {
    const files = Array.from({ length: MAX_FILES_NAMED + 3 }, (_, i) => `f${i}`);
    const body = stopComment({
      headSha: HEAD,
      mainSha: MAIN,
      defaultBranch: "main",
      files,
      reason: "x",
    });
    expect(body).toContain("… and 3 more");
    expect(body).not.toContain(`f${MAX_FILES_NAMED}\``);
  });
});

describe("resync", () => {
  it("GivenABehindPrThatMergesCleanly_WhenRun_ThenUpdateBranchWithTheExpectedHeadAndTheWriteToken", async () => {
    const w = world();
    const { results } = await w.run();
    expect(results).toEqual([
      { number: 7, outcome: "updated", detail: `merged ${MAIN.slice(0, 7)}` },
    ]);
    expect(writes(w.calls)).toEqual([
      {
        method: "PUT",
        path: `/repos/${REPO}/pulls/7/update-branch`,
        token: "write-token",
        body: { expected_head_sha: HEAD },
      },
    ]);
  });

  it("GivenAPrThatAlreadyHasMain_WhenRun_ThenNothingIsWritten", async () => {
    const w = world({ ancestor: 0 });
    const { results } = await w.run();
    expect(results[0].outcome).toBe("current");
    expect(writes(w.calls)).toEqual([]);
  });

  it("GivenTooManyRunsThisHour_WhenRun_ThenNoPrIsListedAndNoTokenRequested", async () => {
    const w = world({ runsLastHour: MAX_RUNS_PER_HOUR + 1 });
    const out = await w.run();
    expect(out.capped).toBe(true);
    expect(w.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("GivenThreeReSyncsToday_WhenRun_ThenSkippedAtTheDailyCap", async () => {
    const w = world({ recentMerges: 3 });
    const { results } = await w.run();
    expect(results[0]).toMatchObject({
      outcome: "skipped",
      detail: expect.stringContaining("cap 3"),
    });
    expect(writes(w.calls)).toEqual([]);
    const revList = w.gitCalls.find((a) => a[0] === "rev-list");
    expect(revList).toContain("--grep=Merge branch 'main' into ");
    expect(revList).toContain("--fixed-strings");
  });

  it("GivenAConflict_WhenRun_ThenNoUpdateAndOneCommentNamingTheFiles", async () => {
    const w = world({ mergeTree: { status: 1, stdout: "tree\ndocs/features.md\n" } });
    const { results } = await w.run();
    expect(results[0]).toMatchObject({ outcome: "conflict", detail: "1 file(s); comment posted" });
    const [post] = writes(w.calls);
    expect(post).toMatchObject({
      method: "POST",
      path: `/repos/${REPO}/issues/7/comments`,
      token: "write-token",
    });
    expect(post.body.body).toContain("`docs/features.md`");
  });

  it("GivenOurIdenticalCommentExists_WhenTheSameConflictRepeats_ThenNothingIsWritten", async () => {
    const body = stopComment({
      headSha: HEAD,
      mainSha: MAIN,
      defaultBranch: "main",
      files: ["docs/features.md"],
      reason: "merging it conflicts.",
    });
    const w = world({
      mergeTree: { status: 1, stdout: "tree\ndocs/features.md\n" },
      comments: [{ id: 9, user: { login: ACTOR }, body }],
    });
    const { results } = await w.run();
    expect(results[0].detail).toContain("comment unchanged");
    expect(writes(w.calls)).toEqual([]);
  });

  it("GivenOurOlderCommentExists_WhenTheConflictChanges_ThenItIsEditedInPlace", async () => {
    const w = world({
      mergeTree: { status: 1, stdout: "tree\nREADME.md\n" },
      comments: [
        { id: 8, user: { login: "someone" }, body: `${COMMENT_MARKER} forged` },
        { id: 9, user: { login: ACTOR }, body: `${COMMENT_MARKER} old` },
      ],
    });
    await w.run();
    expect(writes(w.calls).map((c) => `${c.method} ${c.path}`)).toEqual([
      `PATCH /repos/${REPO}/issues/comments/9`,
    ]);
  });

  it("GivenTheHeadMovedBeforeTheUpdate_WhenGitHubSays422_ThenSkippedWithoutAComment", async () => {
    const w = world({
      update: {
        status: 422,
        data: { message: "expected head sha didn't match current head ref." },
      },
    });
    const { results } = await w.run();
    expect(results[0].outcome).toBe("skipped");
    expect(writes(w.calls)).toHaveLength(1);
  });

  it("GivenGitHubRefusesForAnotherReason_WhenRun_ThenRefusedAndTheReasonIsCommented", async () => {
    const w = world({
      update: {
        status: 422,
        data: { message: "refusing to allow a GitHub App to update workflow" },
      },
    });
    const { results } = await w.run();
    expect(results[0].outcome).toBe("refused");
    const post = writes(w.calls).find((c) => c.method === "POST");
    expect(post.body.body).toContain("refusing to allow a GitHub App");
  });

  it("GivenOnlySkippedPrs_WhenRun_ThenNoWriteTokenIsRequested", async () => {
    const w = world({ prs: [pr({ draft: true })] });
    const { results } = await w.run();
    expect(results[0].outcome).toBe("skipped");
    expect(w.calls.some((c) => c.method === "FETCH")).toBe(false);
  });

  it("GivenTheControlPlaneRefusesAToken_WhenRun_ThenThrowsBeforeAnyWrite", async () => {
    const w = world({ token: { status: 403, body: { error: "forbidden" } } });
    await expect(w.run()).rejects.toThrow(/refused a repo token/);
    expect(writes(w.calls)).toEqual([]);
  });

  it("GivenATokenWithoutAnActor_WhenRun_ThenThrowsBeforeAnyWrite", async () => {
    const w = world({ token: { status: 200, body: { token: "t" } } });
    await expect(w.run()).rejects.toThrow(/actor/);
    expect(writes(w.calls)).toEqual([]);
  });

  it("GivenTheMainFetchFails_WhenRun_ThenThrowsAndWritesNothing", async () => {
    const w = world({ fetchStatus: 128 });
    await expect(w.run()).rejects.toThrow(/git fetch of main/);
    expect(writes(w.calls)).toEqual([]);
  });

  it("GivenOnePrFails_WhenRun_ThenItIsAnErrorAndTheNextPrIsStillUpdated", async () => {
    const w = world({
      prs: [pr({ number: 1, updated_at: "2026-11-01T00:00:00Z" }), pr({ number: 2 })],
    });
    const github = w.github;
    w.github = async (method, path, opts) => {
      if (path.endsWith("/pulls/1/update-branch")) throw new Error("PUT returned HTTP 403: locked");
      return github(method, path, opts);
    };
    const { results } = await w.run();
    expect(results.map((r) => `${r.number} ${r.outcome}`)).toEqual(["1 error", "2 updated"]);
    expect(results[0].detail).toContain("403");
  });

  it("GivenTheHeadMovedSinceTheListing_WhenFetched_ThenSkipped", async () => {
    const w = world({ fetchedHead: "c".repeat(40) });
    const { results } = await w.run();
    expect(results[0].outcome).toBe("skipped");
    expect(writes(w.calls)).toEqual([]);
  });

  it("GivenMissingEnv_WhenRun_ThenThrows", async () => {
    await expect(
      resync({
        env: { ...env, READ_TOKEN: "" },
        git: () => ({}),
        github: async () => ({}),
        emit: () => {},
        now: () => new Date(),
      }),
    ).rejects.toThrow(/READ_TOKEN/);
  });
});

describe("summaryTable", () => {
  it("GivenResults_WhenSummarised_ThenOneRowEach", () => {
    expect(summaryTable([{ number: 1, outcome: "updated", detail: "merged a\nb" }])).toContain(
      "| #1 | updated | merged a b |",
    );
  });
});

describe("gitRunner against a real repository", () => {
  /** A repo with `main` and a branch that both changed line 1 of a.txt; the branch merged `main` once. */
  function repoWithConflict() {
    const dir = mkdtempSync(join(tmpdir(), "resync-"));
    const git = gitRunner(dir);
    const ok = (args, extra) => {
      const r = git(args, extra);
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const as = (name) => ({
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: "x@example.invalid",
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: "x@example.invalid",
    });
    ok(["init", "--quiet", "-b", "main"]);
    writeFileSync(join(dir, "a.txt"), "one\n");
    ok(["add", "."]);
    ok(["commit", "--quiet", "-m", "base"], as("dev"));
    ok(["checkout", "--quiet", "-b", "side"]);
    writeFileSync(join(dir, "b.txt"), "side\n");
    ok(["add", "."]);
    ok(["commit", "--quiet", "-m", "side work"], as("dev"));
    ok(["checkout", "--quiet", "main"]);
    writeFileSync(join(dir, "c.txt"), "main\n");
    ok(["add", "."]);
    ok(["commit", "--quiet", "-m", "main work"], as("dev"));
    ok(["checkout", "--quiet", "side"]);
    ok(["merge", "--quiet", "--no-ff", "--no-edit", "main"], as(ACTOR));
    writeFileSync(join(dir, "a.txt"), "side\n");
    ok(["commit", "--quiet", "-am", "side edit"], as("dev"));
    ok(["checkout", "--quiet", "main"]);
    writeFileSync(join(dir, "a.txt"), "main\n");
    ok(["commit", "--quiet", "-am", "main edit"], as("dev"));
    return { git, main: ok(["rev-parse", "main"]), side: ok(["rev-parse", "side"]) };
  }

  it("GivenBothSidesChangedALine_WhenMergeTreeRuns_ThenExit1AndTheFileIsNamed", () => {
    const { git, main, side } = repoWithConflict();
    const r = git(["merge-tree", "--write-tree", "--name-only", "--no-messages", main, side]);
    expect(r.status).toBe(1);
    expect(conflictFiles(r.stdout)).toEqual(["a.txt"]);
    expect(git(["merge-base", "--is-ancestor", main, side]).status).toBe(1);
  });

  it("GivenOneMergeOfMainOnTheBranch_WhenCountedByMessage_ThenOne", () => {
    const { git, main, side } = repoWithConflict();
    const args = ["rev-list", "--count", "--merges", "--since=24 hours ago", "--fixed-strings"];
    expect(git([...args, `--grep=${mergeMessage("main")}`, `${main}..${side}`]).stdout.trim()).toBe(
      "1",
    );
    expect(
      git([...args, `--grep=${mergeMessage("trunk")}`, `${main}..${side}`]).stdout.trim(),
    ).toBe("0");
  });
});
