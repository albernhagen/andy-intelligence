import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_PACKAGES,
  RELEASE_AGE_MINUTES,
  add,
  addCommands,
  apply,
  checkFileSet,
  checkLockfileSources,
  checkNoCooldownExemptions,
  checkPnpmVersion,
  expectedFiles,
  parsePackages,
  runPnpm,
} from "./executor-deps.mjs";

/** AI-386 (ADR-0156): the trusted install of a build's plan-named packages. */

// Git hooks set GIT_DIR and the like for the outer repo; never let a git call here reach it.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();

const pkg = (name, extra = {}) => ({ name, kind: "runtime", workspace: ".", why: "x", ...extra });
const json = (list) => JSON.stringify(list);

/** A committed project: a root package.json and lockfile, plus apps/web for a monorepo. */
function project({ monorepo = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deps-"));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "package.json"), '{"name":"p"}\n');
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  if (monorepo) {
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    mkdirSync(join(dir, "apps/web"), { recursive: true });
    writeFileSync(join(dir, "apps/web/package.json"), '{"name":"web"}\n');
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  return dir;
}

/** A fake pnpm: adds each name to the workspace's manifest and touches the lockfile. */
function fakePnpm(root, { alsoWrite } = {}) {
  return (args) => {
    const workspace = args[args.indexOf("--dir") + 1];
    const names = args.slice(
      args.indexOf(`--config.minimum-release-age=${RELEASE_AGE_MINUTES}`) + 1,
    );
    const file = join(root, workspace, "package.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    const section = args.includes("--save-dev") ? "devDependencies" : "dependencies";
    manifest[section] = {
      ...manifest[section],
      ...Object.fromEntries(names.map((n) => [n, "^1.0.0"])),
    };
    writeFileSync(file, JSON.stringify(manifest));
    writeFileSync(join(root, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n# ${names.join(" ")}\n`);
    if (alsoWrite) writeFileSync(join(root, alsoWrite), "planted");
  };
}

describe("parsePackages", () => {
  it("GivenValidPackages_WhenParsed_ThenNameKindAndWorkspaceAreKept", () => {
    expect(
      parsePackages(json([pkg("zod"), pkg("@s/x", { kind: "dev", workspace: "apps/web" })])),
    ).toEqual([
      { name: "zod", kind: "runtime", workspace: "." },
      { name: "@s/x", kind: "dev", workspace: "apps/web" },
    ]);
  });

  it("GivenMorePackagesThanTheCap_WhenParsed_ThenItIsRefused", () => {
    const many = Array.from({ length: MAX_PACKAGES + 1 }, (_, i) => pkg(`p${i}`));
    expect(() => parsePackages(json(many))).toThrow(/cap is 5/);
  });

  it("GivenAVersionFlagOrUrl_WhenParsed_ThenItIsRefused", () => {
    for (const name of [
      "zod@3",
      "--registry=https://evil.test",
      "git+https://x/y",
      "file:..",
      "-D",
    ]) {
      expect(() => parsePackages(json([pkg(name)])), name).toThrow(/npm package name/);
    }
  });

  it("GivenAnEscapingWorkspace_WhenParsed_ThenItIsRefused", () => {
    for (const workspace of ["..", "../x", "/etc", "apps/../..", "--filter"]) {
      expect(() => parsePackages(json([pkg("zod", { workspace })])), workspace).toThrow(
        /directory/,
      );
    }
  });

  it("GivenNoPackagesOrBadJson_WhenParsed_ThenItIsRefused", () => {
    expect(() => parsePackages("[]")).toThrow(/no packages/);
    expect(() => parsePackages("nope")).toThrow(/JSON/);
    expect(() => parsePackages(json([pkg("zod"), pkg("zod", { kind: "dev" })]))).toThrow(/twice/);
  });
});

describe("addCommands", () => {
  it("GivenPackages_WhenCommandsAreBuilt_ThenEachHasTheCooldownAndScriptsOff", () => {
    const commands = addCommands(
      parsePackages(
        json([pkg("zod"), pkg("vitest", { kind: "dev" }), pkg("react", { workspace: "apps/web" })]),
      ),
      true,
    );
    expect(commands).toEqual([
      [
        "--dir",
        ".",
        "add",
        "--save-dev",
        "--workspace-root",
        "--lockfile-only",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        "--config.minimum-release-age=10080",
        "vitest",
      ],
      [
        "--dir",
        ".",
        "add",
        "--workspace-root",
        "--lockfile-only",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        "--config.minimum-release-age=10080",
        "zod",
      ],
      [
        "--dir",
        "apps/web",
        "add",
        "--lockfile-only",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        "--config.minimum-release-age=10080",
        "react",
      ],
    ]);
    expect(RELEASE_AGE_MINUTES).toBe(7 * 24 * 60);
  });

  it("GivenASinglePackageRepo_WhenCommandsAreBuilt_ThenNoWorkspaceRootFlag", () => {
    const [command] = addCommands(parsePackages(json([pkg("zod")])), false);
    expect(command).not.toContain("--workspace-root");
  });
});

describe("expectedFiles and checkFileSet", () => {
  it("GivenPackagesInTwoWorkspaces_WhenListed_ThenBothManifestsAndTheLockfile", () => {
    expect(
      expectedFiles(parsePackages(json([pkg("a"), pkg("b", { workspace: "apps/web" })]))),
    ).toEqual(["apps/web/package.json", "package.json", "pnpm-lock.yaml"]);
  });

  it("GivenAnExtraOrMissingFile_WhenChecked_ThenItIsRefused", () => {
    expect(() =>
      checkFileSet(
        ["package.json", "pnpm-lock.yaml", ".npmrc"],
        ["package.json", "pnpm-lock.yaml"],
        "x",
      ),
    ).toThrow(/\.npmrc/);
    expect(() => checkFileSet(["package.json"], ["package.json", "pnpm-lock.yaml"], "x")).toThrow(
      /missing pnpm-lock/,
    );
  });
});

describe("runPnpm", () => {
  it("GivenPnpmFindsNoMatureVersion_WhenRun_ThenTheErrorNamesPnpmsReason", () => {
    const spawn = () => ({
      status: 1,
      stdout: "",
      stderr: "noise\nERR_PNPM_NO_MATURE_MATCHING_VERSION  No matching version\nmore\n",
    });
    const args = addCommands(parsePackages(json([pkg("zod")])), false)[0];
    expect(() => runPnpm(args, {}, spawn)).toThrow(
      /couldn't add zod: ERR_PNPM_NO_MATURE_MATCHING_VERSION/,
    );
  });
});

describe("add and apply", () => {
  it("GivenPlanPackages_WhenAddedThenApplied_ThenTheCheckoutGetsTheManifestAndLockfile", () => {
    const resolver = project({ monorepo: true });
    const out = mkdtempSync(join(tmpdir(), "deps-out-"));
    const packages = json([pkg("zod"), pkg("react", { workspace: "apps/web", kind: "dev" })]);
    add({
      packagesJson: packages,
      workspace: resolver,
      out,
      pnpmVersion: "10.28.0",
      run: fakePnpm(resolver),
    });
    expect(readFileSync(join(out, "base.sha"), "utf8")).toBe(git(resolver, "rev-parse", "HEAD"));

    const agent = mkdtempSync(join(tmpdir(), "deps-agent-"));
    execFileSync("git", ["clone", "-q", resolver, agent], { env: GIT_ENV });
    git(agent, "checkout", "-q", "--", ".");
    execFileSync("git", ["-C", resolver, "checkout", "-q", "--", "."], { env: GIT_ENV });
    const head = git(agent, "rev-parse", "HEAD");
    expect(apply({ packagesJson: packages, workspace: agent, input: out, headSha: head })).toEqual([
      "apps/web/package.json",
      "package.json",
      "pnpm-lock.yaml",
    ]);
    expect(
      JSON.parse(readFileSync(join(agent, "apps/web/package.json"), "utf8")).devDependencies,
    ).toEqual({ react: "^1.0.0" });
    expect(git(agent, "status", "--porcelain").split("\n").length).toBe(3);
  });

  it("GivenAnInstallThatWritesAnotherFile_WhenAdded_ThenItIsRefused", () => {
    const dir = project();
    const out = mkdtempSync(join(tmpdir(), "deps-out-"));
    expect(() =>
      add({
        packagesJson: json([pkg("zod")]),
        workspace: dir,
        out,
        pnpmVersion: "10.28.0",
        run: fakePnpm(dir, { alsoWrite: ".npmrc" }),
      }),
    ).toThrow(/changed files it may not: \.npmrc/);
  });

  it("GivenAWorkspaceWithoutAManifestOrASymlink_WhenAdded_ThenItIsRefused", () => {
    const dir = project();
    const out = mkdtempSync(join(tmpdir(), "deps-out-"));
    expect(() =>
      add({
        packagesJson: json([pkg("zod", { workspace: "apps/none" })]),
        workspace: dir,
        out,
        pnpmVersion: "10.28.0",
        run: fakePnpm(dir),
      }),
    ).toThrow();
    symlinkSync(tmpdir(), join(dir, "escape"));
    expect(() =>
      add({
        packagesJson: json([pkg("zod", { workspace: "escape" })]),
        workspace: dir,
        out,
        pnpmVersion: "10.28.0",
        run: fakePnpm(dir),
      }),
    ).toThrow(/outside the repo|no package.json/);
  });

  it("GivenResolvedFilesFromAnotherCommit_WhenApplied_ThenItIsRefused", () => {
    const dir = project();
    const out = mkdtempSync(join(tmpdir(), "deps-out-"));
    add({
      packagesJson: json([pkg("zod")]),
      workspace: dir,
      out,
      pnpmVersion: "10.28.0",
      run: fakePnpm(dir),
    });
    expect(() =>
      apply({
        packagesJson: json([pkg("zod")]),
        workspace: dir,
        input: out,
        headSha: "f".repeat(40),
      }),
    ).toThrow(/start the build again/);
  });

  it("GivenAnArtifactWithAnExtraFile_WhenApplied_ThenItIsRefused", () => {
    const dir = project();
    const out = mkdtempSync(join(tmpdir(), "deps-out-"));
    add({
      packagesJson: json([pkg("zod")]),
      workspace: dir,
      out,
      pnpmVersion: "10.28.0",
      run: fakePnpm(dir),
    });
    writeFileSync(join(out, ".npmrc"), "registry=https://evil.test");
    const head = git(dir, "rev-parse", "HEAD");
    expect(() =>
      apply({ packagesJson: json([pkg("zod")]), workspace: dir, input: out, headSha: head }),
    ).toThrow(/\.npmrc/);
  });

  it("GivenAManifestWithoutTheNamedPackage_WhenApplied_ThenItIsRefused", () => {
    const dir = project();
    const out = mkdtempSync(join(tmpdir(), "deps-out-"));
    add({
      packagesJson: json([pkg("zod")]),
      workspace: dir,
      out,
      pnpmVersion: "10.28.0",
      run: fakePnpm(dir),
    });
    writeFileSync(join(out, "package.json"), '{"name":"p"}');
    const head = git(dir, "rev-parse", "HEAD");
    expect(() =>
      apply({ packagesJson: json([pkg("zod")]), workspace: dir, input: out, headSha: head }),
    ).toThrow(/zod isn't in package.json/);
  });
});

describe("cooldown and source guards (AI-386 review)", () => {
  it("GivenAPnpmOlderThan10_16_WhenChecked_ThenItIsRefusedBecauseTheCooldownWouldBeIgnored", () => {
    for (const v of ["10.8.0", "9.15.4", "10.15.9"]) {
      expect(() => checkPnpmVersion(v), v).toThrow(/can't enforce the 7-day cooldown/);
    }
    for (const v of ["10.16.0", "10.28.0\n", "11.0.0"]) {
      expect(() => checkPnpmVersion(v), v).not.toThrow();
    }
    expect(() => checkPnpmVersion("garbage")).toThrow(/can't read/);
  });

  it("GivenAnOldPnpm_WhenAdded_ThenNothingIsResolved", () => {
    const dir = project();
    const out = mkdtempSync(join(tmpdir(), "deps-out-"));
    let ran = false;
    expect(() =>
      add({
        packagesJson: json([pkg("zod")]),
        workspace: dir,
        out,
        pnpmVersion: "10.8.0",
        run: () => {
          ran = true;
        },
      }),
    ).toThrow(/cooldown/);
    expect(ran).toBe(false);
  });

  it("GivenAProjectThatExemptsPackagesFromTheCooldown_WhenChecked_ThenItIsRefused", () => {
    const dir = project();
    expect(() => checkNoCooldownExemptions(dir)).not.toThrow();
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "minimumReleaseAgeExclude:\n  - zod\n");
    expect(() => checkNoCooldownExemptions(dir)).toThrow(/exempts packages/);
  });

  it("GivenALockfileWithAGitOrTarballSource_WhenChecked_ThenItIsRefused", () => {
    const dir = mkdtempSync(join(tmpdir(), "deps-lock-"));
    writeFileSync(
      join(dir, "pnpm-lock.yaml"),
      "packages:\n  a@1.0.0:\n    resolution: {integrity: sha512-x}\n",
    );
    expect(() => checkLockfileSources(dir)).not.toThrow();
    writeFileSync(
      join(dir, "pnpm-lock.yaml"),
      "packages:\n  b@1.0.0:\n    resolution: {tarball: https://evil.test/b.tgz}\n",
    );
    expect(() => checkLockfileSources(dir)).toThrow(/outside the registry/);
  });

  it("GivenAPackageAlreadyInItsManifest_WhenAdded_ThenItSucceedsWithTheFilesUnchanged", () => {
    const dir = project();
    writeFileSync(join(dir, "package.json"), '{"name":"p","dependencies":{"zod":"^1.0.0"}}');
    git(dir, "commit", "-qam", "has zod");
    const out = mkdtempSync(join(tmpdir(), "deps-out-"));
    expect(
      add({
        packagesJson: json([pkg("zod")]),
        workspace: dir,
        out,
        pnpmVersion: "10.28.0",
        run: () => {},
      }),
    ).toEqual(["package.json", "pnpm-lock.yaml"]);
    const head = git(dir, "rev-parse", "HEAD");
    expect(
      apply({ packagesJson: json([pkg("zod")]), workspace: dir, input: out, headSha: head }),
    ).toEqual(["package.json", "pnpm-lock.yaml"]);
  });
});
