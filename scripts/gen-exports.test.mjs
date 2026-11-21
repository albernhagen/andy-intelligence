import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BARRELS,
  GEN_FILE,
  INDEX_LINE,
  REPO,
  generate,
  modulesIn,
  renderBarrel,
} from "./gen-exports.mjs";
import { cleanGitEnv } from "./git-env.mjs";

const DOMAIN = "packages/domain/src";

/** A temp repo root whose domain folder holds `files` (name → text). */
const repo = (files) => {
  const root = mkdtempSync(join(tmpdir(), "gen-exports-"));
  mkdirSync(join(root, DOMAIN), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, DOMAIN, name), text);
  return root;
};
const barrel = (root) => readFileSync(join(root, DOMAIN, GEN_FILE), "utf8");
const exported = (text) => [...text.matchAll(/^export \* from "\.\/([^"]+)";$/gm)].map((m) => m[1]);

// A git hook (pre-push runs the tests) exports GIT_DIR and friends; inherited, they would point
// these temporary repos' git commands at the real one (AI-135).
const GIT_ENV = {
  ...cleanGitEnv(),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, stdio: "pipe" }).trim();

describe("modulesIn", () => {
  it("GivenAFolder_WhenListed_ThenOnlySiblingModulesSortedWithoutTestsIndexGenOrInternal", () => {
    const root = repo({
      "b.ts": "",
      "a.ts": "",
      "a.test.ts": "",
      "index.ts": "",
      [GEN_FILE]: "",
      "types.d.ts": "",
      "secret.ts": "",
      "notes.md": "",
    });
    mkdirSync(join(root, DOMAIN, "sub"));
    writeFileSync(join(root, DOMAIN, "sub", "index.ts"), "");

    expect(modulesIn(join(root, DOMAIN), ["secret"])).toEqual(["a", "b"]);
  });
});

describe("generate", () => {
  it("GivenModules_WhenGenerated_ThenBarrelExportsEachOnceInOrder", () => {
    const root = repo({ "zeta.ts": "", "alpha.ts": "", "index.ts": INDEX_LINE });

    generate(root);

    expect(exported(barrel(root))).toEqual(["alpha", "zeta"]);
  });

  it("GivenAnUpToDateBarrel_WhenGeneratedAgain_ThenNothingIsWritten", () => {
    const root = repo({ "a.ts": "" });
    expect(generate(root)).toHaveLength(1);

    expect(generate(root)).toEqual([]);
  });

  it("GivenANewModule_WhenGeneratedAgain_ThenTheBarrelGainsIt", () => {
    const root = repo({ "a.ts": "" });
    generate(root);
    writeFileSync(join(root, DOMAIN, "b.ts"), "");

    generate(root);

    expect(exported(barrel(root))).toEqual(["a", "b"]);
  });

  // The Playwright web server runs the script from apps/web (AI-277: the first CI run wrote nothing).
  it("GivenNoRoot_WhenResolved_ThenItIsThisRepoNotTheWorkingDirectory", () => {
    expect(existsSync(join(REPO, "scripts", "gen-exports.mjs"))).toBe(true);
  });

  it("GivenAMissingFolder_WhenGenerated_ThenItIsSkipped", () => {
    const root = mkdtempSync(join(tmpdir(), "gen-exports-empty-"));

    expect(generate(root)).toEqual([]);
  });

  // The ticket's acceptance criterion: two branches that each add a module next to the same
  // neighbour merge without a conflict, and the barrel exports both (AI-277).
  it("GivenTwoBranchesAddingNeighbourModules_WhenMerged_ThenNoConflictAndBothExported", () => {
    const root = repo({ "a.ts": "", "index.ts": `${INDEX_LINE}\n` });
    writeFileSync(join(root, ".gitignore"), `**/${GEN_FILE}\n`);
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "one");
    writeFileSync(join(root, DOMAIN, "b.ts"), "");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "one");
    git(root, "checkout", "-q", "-b", "two", "main");
    writeFileSync(join(root, DOMAIN, "c.ts"), "");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "two");

    git(root, "checkout", "-q", "main");
    git(root, "merge", "-q", "--no-edit", "one");
    git(root, "merge", "-q", "--no-edit", "two");
    generate(root);

    expect(exported(barrel(root))).toEqual(["a", "b", "c"]);
    expect(git(root, "status", "--porcelain")).toBe("");
  });
});

describe("renderBarrel", () => {
  it("GivenModules_WhenRendered_ThenOneExportLinePerModuleAfterAHeader", () => {
    expect(renderBarrel(["a", "b"]).split("\n").slice(1)).toEqual([
      'export * from "./a";',
      'export * from "./b";',
      "",
    ]);
  });
});

// This repo's barrels: each index re-exports only the generated file, so no hand-kept export
// list (the shared edit that conflicted) comes back, and every internal entry still exists.
describe.each(Object.entries(BARRELS))("barrel %s", (dir, internal) => {
  const index = readFileSync(join(dir, "index.ts"), "utf8");

  it("GivenItsIndex_WhenRead_ThenItReExportsTheGeneratedFileOnce", () => {
    expect(index.split("\n").filter((line) => line === INDEX_LINE)).toHaveLength(1);
  });

  it("GivenItsIndex_WhenRead_ThenNoSiblingModuleIsReExportedByHand", () => {
    expect(index).not.toMatch(
      /^export (?:\*|\{[^}]*\}|type \{[^}]*\}) from "\.\/(?!exports\.gen")/m,
    );
  });

  it("GivenItsInternalList_WhenChecked_ThenEachIsAModuleInTheFolder", () => {
    for (const name of internal) expect(existsSync(join(dir, `${name}.ts`))).toBe(true);
  });

  it("GivenTheFolder_WhenListed_ThenNoModuleAppearsTwice", () => {
    const modules = modulesIn(dir, internal);
    expect(new Set(modules).size).toBe(modules.length);
  });
});
