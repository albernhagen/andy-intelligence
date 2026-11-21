import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../git-env.mjs";
import { resolveAddOnly, resyncBranch } from "./resync.mjs";

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
  git(root, "clone", origin, work);
  git(work, "config", "user.name", "Test");
  git(work, "config", "user.email", "test@example.invalid");
  writeFileSync(join(work, "list.md"), "| a |\n| z |\n");
  writeFileSync(join(work, "code.txt"), "one\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "base");
  git(work, "push", "origin", "main");
  return { git, origin, work };
}

function commit(r, branch, file, text) {
  r.git(r.work, "checkout", "-q", branch);
  writeFileSync(join(r.work, file), text);
  r.git(r.work, "commit", "-qam", `${branch} edits ${file}`);
  r.git(r.work, "push", "-q", "origin", branch);
}

describe("resyncBranch", () => {
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
