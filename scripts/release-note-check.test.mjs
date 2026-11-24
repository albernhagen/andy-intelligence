import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applies, check, prFiles } from "./release-note-check.mjs";
import { buildTable } from "./screenshot-table.mjs";

const event = (body, extra = {}) => ({
  repository: { default_branch: "main" },
  pull_request: { body, base: { ref: "main" }, user: { login: "albernhagen" }, ...extra },
});
const GOOD = "What changed: A page.\nHow it works: A route.";

describe("check", () => {
  it("GivenAValidBlock_WhenChecked_ThenOk", () => {
    expect(check(event(GOOD))).toEqual({
      ok: true,
      lines: ["Release note: OK."],
      warnings: [],
      summary: null,
    });
  });

  it("GivenNoBlock_WhenChecked_ThenFailsNamingEachField", () => {
    const result = check(event("## Summary"));
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain('"What changed:" is missing or empty.');
    expect(result.lines.join("\n")).toContain('"How it works:" is missing or empty.');
  });

  it("GivenADependabotPr_WhenChecked_ThenSkipped", () => {
    expect(check(event("", { user: { login: "dependabot[bot]" } })).ok).toBe(true);
  });

  it("GivenAPrIntoAnotherBranch_WhenChecked_ThenSkipped", () => {
    expect(check(event("", { base: { ref: "epic/AI-84" } })).ok).toBe(true);
  });
});

describe("before and after (AI-353)", () => {
  const BASE = "a".repeat(40);
  const HEAD = "b".repeat(40);
  const IMG = "apps/web/e2e/__screenshots__/board.png";
  const NEW = "apps/web/e2e/__screenshots__/new.png";
  const pr = (body) => ({
    repository: { default_branch: "main", full_name: "o/r", private: false },
    pull_request: { body, base: { ref: "main" }, head: { sha: HEAD }, user: { login: "a" } },
  });
  const tableFor = (files, headSha = HEAD) =>
    buildTable({ owner: "o", repo: "r", baseSha: BASE, headSha, files });
  const changed = [
    { path: IMG, status: "modified" },
    { path: NEW, status: "added" },
  ];

  it("GivenAChangedImageAndNoTable_WhenChecked_ThenFailsSayingHowToAddIt", () => {
    const result = check(pr(GOOD), changed);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain('no "Before and after" table');
    expect(text).toContain("pnpm screenshots:table --write");
  });

  it("GivenAChangedImageAndItsTable_WhenChecked_ThenPassesAndPrintsTheTableToTheSummary", () => {
    const result = check(pr(`${GOOD}\n\n${tableFor(changed)}`), changed);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.summary).toContain("## Before and after");
    expect(result.summary).toContain(`https://raw.githubusercontent.com/o/r/${HEAD}/${IMG}`);
  });

  it("GivenATableMissingAnImage_WhenChecked_ThenFailsNamingIt", () => {
    const result = check(pr(`${GOOD}\n\n${tableFor([changed[0]])}`), changed);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain(`no after image for: ${NEW}`);
  });

  it("GivenATableLinkingAnotherRepo_WhenChecked_ThenFailsAndTheSummaryLeavesItOut", () => {
    const other = buildTable({
      owner: "x",
      repo: "y",
      baseSha: BASE,
      headSha: HEAD,
      files: changed,
    });
    const result = check(pr(`${GOOD}\n\n${other}`), changed);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("this repo's files");
    expect(result.summary).not.toContain("/x/y/");
  });

  it("GivenATableFromAnOlderCommit_WhenChecked_ThenPassesWithAWarning", () => {
    const result = check(pr(`${GOOD}\n\n${tableFor(changed, "c".repeat(40))}`), changed);
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("older commit");
  });

  it("GivenOnlyARemovedImage_WhenCheckedWithAnEmptyTable_ThenPasses", () => {
    const removed = [{ path: IMG, status: "removed" }];
    expect(check(pr(`${GOOD}\n\n${tableFor(removed)}`), removed).ok).toBe(true);
  });

  it("GivenWebSourceChangedAndNoImage_WhenChecked_ThenFlaggedAsAWarningNotAFailure", () => {
    const result = check(pr(GOOD), [{ path: "apps/web/src/App.tsx", status: "modified" }]);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("apps/web/src/ but no stored screenshot");
  });

  it("GivenAnotherUiSource_WhenChecked_ThenThatFolderIsWatched", () => {
    const files = [{ path: "web/app/page.tsx", status: "modified" }];
    expect(check(pr(GOOD), files, "web/app").warnings).toHaveLength(1);
    expect(check(pr(GOOD), files).warnings).toEqual([]);
  });

  it("GivenADocsOnlyPr_WhenChecked_ThenUntouched", () => {
    const result = check(pr(GOOD), [{ path: "docs/README.md", status: "modified" }]);
    expect(result).toEqual({ ok: true, lines: ["Release note: OK."], warnings: [], summary: null });
  });

  it("GivenAPrivateRepo_WhenChecked_ThenTheRuleIsSkippedWithANote", () => {
    const result = check(pr(GOOD), null);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("public repo");
  });

  it("GivenAPrIntoAnotherBranch_WhenAsked_ThenNotApplicableAndNoApiCall", () => {
    expect(applies(event("", { base: { ref: "m11/x" } }))).toBe(false);
    expect(applies(event("", { user: { login: "dependabot[bot]" } }))).toBe(false);
    expect(applies(event(GOOD))).toBe(true);
  });
});

describe("prFiles", () => {
  const ev = (priv) => ({
    repository: { full_name: "o/r", private: priv },
    pull_request: { number: 7 },
  });
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });

  it("GivenAPrivateRepo_WhenListed_ThenNullAndNoCall", async () => {
    let calls = 0;
    expect(await prFiles(ev(true), "t", async () => (calls++, reply(200, [])))).toBeNull();
    expect(calls).toBe(0);
  });

  it("GivenARenameAndPages_WhenListed_ThenEveryFileWithRenamesSplit", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      filename: `f${i}`,
      status: "modified",
    }));
    const page2 = [{ filename: "b.png", previous_filename: "a.png", status: "renamed" }];
    const urls = [];
    const files = await prFiles(ev(false), "t", async (url) => {
      urls.push(url);
      return reply(200, urls.length === 1 ? page1 : page2);
    });
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/pulls/7/files?per_page=100&page=1");
    expect(files).toHaveLength(102);
    expect(files.slice(-2)).toEqual([
      { path: "a.png", status: "removed" },
      { path: "b.png", status: "added" },
    ]);
  });

  it("GivenTheTokenIsRefused_WhenListed_ThenRetriedWithoutIt", async () => {
    const auth = [];
    const files = await prFiles(ev(false), "t", async (_url, init) => {
      auth.push(init.headers.authorization ?? null);
      return auth.length === 1 ? reply(403, {}) : reply(200, [{ filename: "x", status: "added" }]);
    });
    expect(auth).toEqual(["Bearer t", null]);
    expect(files).toEqual([{ path: "x", status: "added" }]);
  });

  it("GivenTheApiFails_WhenListed_ThenThrows", async () => {
    await expect(prFiles(ev(false), "t", async () => reply(500, {}))).rejects.toThrow("HTTP 500");
  });
});

describe("cli", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "release-note-check.mjs");
  const run = (body) => {
    const dir = mkdtempSync(join(tmpdir(), "release-note-"));
    const path = join(dir, "event.json");
    writeFileSync(path, JSON.stringify(event(body)));
    try {
      return {
        code: 0,
        out: execFileSync("node", [script], {
          env: { ...process.env, GITHUB_EVENT_PATH: path },
        }).toString(),
      };
    } catch (err) {
      return { code: err.status, out: err.stdout.toString() };
    }
  };

  it("GivenAValidEventFile_WhenRun_ThenExitsZero", () => {
    expect(run(GOOD)).toEqual({ code: 0, out: "Release note: OK.\n" });
  });

  it("GivenAFieldOverItsCap_WhenRun_ThenExitsOneWithAnAnnotation", () => {
    const long = Array.from({ length: 30 }, () => "w").join(" ");
    const { code, out } = run(`What changed: ${long}\nHow it works: x`);
    expect(code).toBe(1);
    expect(out).toContain('::error::- "What changed:" is 30 words; the cap is 25 (5 over).');
  });
});
