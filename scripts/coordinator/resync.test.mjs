import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../git-env.mjs";
import { sh } from "./lib.mjs";
import { resolveAddOnly, resyncBranch, scrubbedEnv } from "./resync.mjs";

const hunk = (ours, base, theirs) =>
  [
    "<<<<<<< HEAD",
    ...ours,
    "||||||| base",
    ...base,
    "=======",
    ...theirs,
    ">>>>>>> origin/main",
  ].join("\n");

describe("scrubbedEnv", () => {
  it("GivenTokensInEnv_WhenScrubbed_ThenOnlyHarmlessVariablesKept", () => {
    const env = {
      PATH: "/bin",
      HOME: "/h",
      GH_TOKEN: "x",
      GITHUB_TOKEN: "x",
      ANTHROPIC_API_KEY: "x",
      CLAUDE_CODE_OAUTH_TOKEN: "x",
      GOOGLE_APPLICATION_CREDENTIALS: "x",
    };
    expect(scrubbedEnv(env)).toEqual({ PATH: "/bin", HOME: "/h" });
  });
});

describe("resolveAddOnly", () => {
  it("GivenBothSidesAddedRows_WhenResolved_ThenBothKeptBranchFirst", () => {
    const text = ["| a |", hunk(["| ours |"], [], ["| theirs |"]), "| z |"].join("\n");
    expect(resolveAddOnly(text)).toEqual({
      ok: true,
      hunks: 1,
      text: "| a |\n| ours |\n| theirs |\n| z |",
    });
  });

  it("GivenOneSideChangedALine_WhenResolved_ThenRefused", () => {
    expect(resolveAddOnly(hunk(["new"], ["old"], ["old", "added"]))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/changed or removed/),
    });
  });

  it("GivenTwoWayMarkers_WhenResolved_ThenRefusedForMissingBase", () => {
    const twoWay = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main";
    expect(resolveAddOnly(twoWay)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/no merge base/),
    });
  });

  it("GivenUnterminatedHunk_WhenResolved_ThenRefused", () => {
    expect(resolveAddOnly("<<<<<<< HEAD\nx\n||||||| base\n=======\n")).toMatchObject({ ok: false });
  });

  it("GivenNoMarkers_WhenResolved_ThenRefused", () => {
    expect(resolveAddOnly("plain\n")).toMatchObject({ ok: false, reason: "no conflict hunks" });
  });
});

/** A bare origin with main and a PR branch, plus a clone that plays the coordinator's checkout. */
function repos() {
  const root = mkdtempSync(join(tmpdir(), "resync-test-"));
  const env = cleanGitEnv();
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  git(root, "init", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, work);
  git(work, "config", "user.name", "Test");
  git(work, "config", "user.email", "test@example.invalid");
  writeFileSync(join(work, "list.md"), "| a |\n| z |\n");
  writeFileSync(join(work, "code.txt"), "one\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "base");
  git(work, "push", "-q", "origin", "main");
  return { git, origin, work };
}

function commit(r, branch, file, text) {
  r.git(r.work, "checkout", "-q", branch);
  writeFileSync(join(r.work, file), text);
  r.git(r.work, "commit", "-qam", `${branch} edits ${file}`);
  r.git(r.work, "push", "-q", "origin", branch);
}

// Real git in temp repos: a loaded machine runs these past vitest's 5 s default.
describe("resyncBranch", { timeout: 30_000 }, () => {
  it("GivenBothSidesAddedAtSamePlace_WhenResynced_ThenResolvedAndPushedWithoutForce", () => {
    const r = repos();
    r.git(r.work, "checkout", "-qb", "pr");
    commit(r, "pr", "list.md", "| a |\n| pr |\n| z |\n");
    commit(r, "main", "list.md", "| a |\n| main |\n| z |\n");
    r.git(r.work, "checkout", "-q", "--detach");

    const result = resyncBranch({ repo: r.work, branch: "pr", checks: [] });

    expect(result).toMatchObject({ ok: true, resolved: ["list.md"] });
    r.git(r.work, "fetch", "-q", "origin");
    expect(r.git(r.work, "show", "origin/pr:list.md")).toBe("| a |\n| pr |\n| main |\n| z |\n");
    expect(() =>
      r.git(r.work, "merge-base", "--is-ancestor", "origin/main", "origin/pr"),
    ).not.toThrow();
  });

  it("GivenAddOnlyConflictInCodeFile_WhenResynced_ThenLeftForTheWorker", () => {
    const r = repos();
    r.git(r.work, "checkout", "-qb", "pr");
    commit(r, "pr", "code.txt", "one\nimport a\n");
    commit(r, "main", "code.txt", "one\nimport a2\n");
    const before = r.git(r.origin, "rev-parse", "pr");

    const result = resyncBranch({ repo: r.work, branch: "pr", checks: [] });

    expect(result).toMatchObject({
      ok: false,
      summary: expect.stringMatching(/code.txt \(not a Markdown file\)/),
    });
    expect(r.git(r.origin, "rev-parse", "pr")).toBe(before);
  });

  it("GivenDefaultChecks_WhenResynced_ThenBudgetScriptComesFromMainNotTheBranch", () => {
    const r = repos();
    mkdirSync(join(r.work, "scripts"), { recursive: true });
    writeFileSync(join(r.work, "scripts/context-budget.mjs"), "process.exit(0);\n");
    r.git(r.work, "add", ".");
    r.git(r.work, "commit", "-qm", "main's budget script passes");
    r.git(r.work, "push", "-q", "origin", "main");
    r.git(r.work, "checkout", "-qb", "pr");
    writeFileSync(join(r.work, "scripts/context-budget.mjs"), "process.exit(9);\n");
    r.git(r.work, "commit", "-qam", "branch's budget script fails");
    r.git(r.work, "push", "-q", "origin", "pr");
    commit(r, "main", "list.md", "| a |\n| main |\n| z |\n");
    const ran = [];
    const run = (cmd, args, opts) => {
      if (cmd === "git") return sh(cmd, args, opts);
      ran.push([cmd, ...args].join(" "));
      return cmd === "node" ? sh(cmd, args, opts) : { status: 0, stdout: "", stderr: "" };
    };

    const result = resyncBranch({ repo: r.work, branch: "pr", run, dryRun: true });

    expect(result).toMatchObject({ ok: true });
    expect(ran[0]).toBe("pnpm install --frozen-lockfile --prefer-offline --ignore-scripts");
    expect(ran[1]).toMatch(/resync-budget-.*context-budget\.mjs \.$/);
  });

  it("GivenRealConflict_WhenResynced_ThenAbortedNothingPushedFilesListed", () => {
    const r = repos();
    r.git(r.work, "checkout", "-qb", "pr");
    commit(r, "pr", "code.txt", "two\n");
    commit(r, "main", "code.txt", "three\n");
    const before = r.git(r.origin, "rev-parse", "pr");

    const result = resyncBranch({ repo: r.work, branch: "pr", checks: [] });

    expect(result).toMatchObject({ ok: false, files: ["code.txt"] });
    expect(result.summary).toMatch(/needs the worker: code.txt/);
    expect(r.git(r.origin, "rev-parse", "pr")).toBe(before);
  });

  it("GivenFailingCheck_WhenResynced_ThenNotPushed", () => {
    const r = repos();
    r.git(r.work, "checkout", "-qb", "pr");
    commit(r, "pr", "code.txt", "two\n");
    commit(r, "main", "list.md", "| a |\n| main |\n| z |\n");
    const before = r.git(r.origin, "rev-parse", "pr");

    const result = resyncBranch({
      repo: r.work,
      branch: "pr",
      checks: [["sh", ["-c", "echo over budget; exit 1"]]],
    });

    expect(result).toMatchObject({ ok: false, summary: expect.stringMatching(/over budget/) });
    expect(r.git(r.origin, "rev-parse", "pr")).toBe(before);
  });

  it("GivenFetchFails_WhenResynced_ThenThrowsAndNeverReportsSynced", () => {
    const r = repos();
    expect(() => resyncBranch({ repo: r.work, branch: "no-such-branch", checks: [] })).toThrow(
      /fetch failed/,
    );
  });

  it("GivenBranchAlreadyContainsMain_WhenResynced_ThenNothingPushed", () => {
    const r = repos();
    r.git(r.work, "checkout", "-qb", "pr");
    commit(r, "pr", "code.txt", "two\n");
    expect(resyncBranch({ repo: r.work, branch: "pr", checks: [] })).toMatchObject({
      ok: true,
      summary: expect.stringMatching(/already contains main/),
    });
    expect(readFileSync(join(r.work, "code.txt"), "utf8")).toBe("two\n");
  });
});
