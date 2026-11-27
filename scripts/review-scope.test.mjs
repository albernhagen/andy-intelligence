import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  AFFECTS_WEB_DIRS,
  AFFECTS_WEB_FILES,
  WEB_WORKSPACE_DEPS,
  canAffectWebApp,
  changedPaths,
  dependencyBumpOutput,
  fileAt,
  gateOutput,
  isDependencyBump,
  isDocsOnly,
  lockedPackages,
  screenshotSkipReason,
} from "./review-scope.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("isDocsOnly", () => {
  it("GivenOnlyDocsAndReadmes_WhenChecked_ThenTrue", () => {
    expect(isDocsOnly(["docs/build-log.md", "README.md", "apps/api/README.md", ""])).toBe(true);
  });

  it("GivenAnyCodeOrWorkflowFile_WhenChecked_ThenFalse", () => {
    expect(isDocsOnly(["docs/build-log.md", "scripts/review-gate.mjs"])).toBe(false);
    expect(isDocsOnly(["README.md", ".github/workflows/ci.yml"])).toBe(false);
    expect(isDocsOnly(["infra/bootstrap/main.tf"])).toBe(false);
  });

  it("GivenAgentRuleFiles_WhenChecked_ThenFalse", () => {
    expect(isDocsOnly(["AGENTS.md"])).toBe(false);
    expect(isDocsOnly(["CLAUDE.md"])).toBe(false);
    expect(isDocsOnly(["docs/BUILD-PROMPT.md"])).toBe(false);
  });

  it("GivenProcedureMarkdown_WhenChecked_ThenFalse", () => {
    expect(isDocsOnly(["platform/procedures/security-review.md"])).toBe(false);
  });

  it("GivenNoFiles_WhenChecked_ThenFalse", () => {
    expect(isDocsOnly([])).toBe(false);
    expect(isDocsOnly([" ", ""])).toBe(false);
  });
});

// The UI screenshots gate (AI-358, AI-406): `run=false` only for a readable change that is
// docs-only or can't affect the web app.
describe("gateOutput", () => {
  it("GivenDocsOnlyChange_WhenGated_ThenSkipsWithReason", () => {
    expect(gateOutput(() => ["docs/runbooks/x.md", "docs/build-log.md", "README.md"])).toBe(
      "run=false\nreason=docs-only change",
    );
  });

  it("GivenOnlyFilesThatCannotAffectTheWebApp_WhenGated_ThenSkipsWithReason", () => {
    expect(gateOutput(() => ["infra/envs/prod/main.tf", ".github/workflows/ci.yml"])).toBe(
      "run=false\nreason=no changed file can affect what the web app renders",
    );
  });

  it("GivenDocsAndCodeChange_WhenGated_ThenRuns", () => {
    expect(gateOutput(() => ["docs/build-log.md", "apps/web/src/App.tsx"])).toBe("run=true");
  });

  // Not docs to the review agents (isDocsOnly stays false), but they can't change a render.
  it("GivenProcedureMarkdownOrNestedAgentsMd_WhenGated_ThenSkipsAsNoWebChangeNotDocsOnly", () => {
    const web = "run=false\nreason=no changed file can affect what the web app renders";
    expect(gateOutput(() => ["docs/build-log.md", "platform/procedures/build.md"])).toBe(web);
    expect(gateOutput(() => ["docs/build-log.md", "infra/AGENTS.md"])).toBe(web);
    expect(gateOutput(() => [".github/AGENTS.md"])).toBe(web);
  });

  it("GivenDetectionThrows_WhenGated_ThenRuns", () => {
    expect(
      gateOutput(() => {
        throw new Error("git failed");
      }),
    ).toBe("run=true");
  });

  it("GivenEmptyChange_WhenGated_ThenRuns", () => {
    expect(gateOutput(() => [""])).toBe("run=true");
  });
});

// AI-406: skip only when every changed path is known not to reach the web app's render.
describe("canAffectWebApp", () => {
  const runs = (paths) => expect(screenshotSkipReason(paths)).toBeNull();
  const skips = (paths) =>
    expect(screenshotSkipReason(paths)).toBe("no changed file can affect what the web app renders");

  it("GivenBackendInfraOrToolingOnly_WhenGated_ThenSkips", () => {
    skips(["infra/modules/api/main.tf", "template/README.md", "apps/local-runner/src/main.ts"]);
    skips(["platform/actions/agent-review/action.yml", "platform/procedures/build.md"]);
    skips(["scripts/context-budget.mjs", "eslint.config.js", "lefthook.yml", "Dockerfile"]);
    skips(["AGENTS.md", "docs/build-log.md", ".claude/settings.json"]);
  });

  it("GivenWebAppChange_WhenGated_ThenRuns", () => {
    runs(["docs/x.md", "apps/web/src/App.tsx"]);
    runs(["apps/web/vite.config.ts"]);
    runs(["apps/web/tsconfig.json"]);
  });

  it("GivenE2eSpecImageOrFakeApiChange_WhenGated_ThenRuns", () => {
    runs(["apps/web/e2e/screenshots.spec.ts"]);
    runs(["apps/web/e2e/__screenshots__/board.png"]);
    runs(["apps/web/e2e/fake-api.ts"]);
    runs(["apps/web/e2e/vite.config.ts"]);
  });

  it("GivenImportedWorkspacePackageChange_WhenGated_ThenRuns", () => {
    for (const dir of WEB_WORKSPACE_DEPS) runs(["infra/x.tf", `${dir}/src/x.ts`]);
    runs(["packages/contracts/AGENTS.md"]);
  });

  it("GivenFileTheApiImportsOutsideItsPackage_WhenGated_ThenRuns", () => {
    runs(["platform/baseline/manifest.json"]);
    runs(["platform/baseline/files.mjs"]);
  });

  it("GivenRootInstallOrBuildConfig_WhenGated_ThenRuns", () => {
    for (const f of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      ".nvmrc",
      "tsconfig.base.json",
    ]) {
      runs([f]);
    }
  });

  it("GivenScriptTheWebServerRuns_WhenGated_ThenRuns", () => {
    runs(["scripts/gen-exports.mjs"]);
  });

  it("GivenTheScreenshotGateWorkflowOrAction_WhenGated_ThenRuns", () => {
    runs(["scripts/review-scope.mjs"]);
    runs(["scripts/playwright-image.mjs"]);
    runs([".github/workflows/ui-screenshots.yml"]);
    runs(["platform/actions/ui-screenshots/action.yml"]);
  });

  it("GivenPathNotOnEitherList_WhenGated_ThenRuns", () => {
    runs(["infra/x.tf", "new-root-file.json"]);
    runs([".gitignore"]);
    runs([".npmrc"]);
    runs(["apps/new-app/src/main.ts"]);
    runs(["packages/new-package/src/index.ts"]);
    runs(["patches/react.patch"]);
    // git quotes unusual paths ("docs/caf\303\251.md"); a quoted path matches nothing, so it runs.
    runs(['"docs/caf\\303\\251.md"', "infra/x.tf"]);
  });

  it("GivenRenameOutOfTheWebApp_WhenGated_ThenRuns", () => {
    // --no-renames lists a rename as its old and new path; the old one is in apps/web.
    runs(["apps/web/src/old.ts", "docs/old.ts"]);
  });

  it("GivenNoChangedFiles_WhenGated_ThenRuns", () => {
    expect(screenshotSkipReason([])).toBeNull();
    expect(screenshotSkipReason(["", " "])).toBeNull();
  });

  it("GivenDocsOnlyRule_WhenWebRuleAdded_ThenUnchanged", () => {
    // The review agents' rule must not loosen: infra and tooling are not docs.
    expect(isDocsOnly(["infra/x.tf"])).toBe(false);
    expect(isDocsOnly(["apps/local-runner/src/main.ts"])).toBe(false);
  });

  it("GivenEveryListedFileAndDir_WhenCheckedAgainstTheRepo_ThenItExists", () => {
    // A rename that leaves a stale entry would quietly stop guarding the new path.
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).split("\n");
    for (const f of AFFECTS_WEB_FILES) expect(tracked, f).toContain(f);
    for (const d of AFFECTS_WEB_DIRS) {
      expect(
        tracked.some((t) => t.startsWith(`${d}/`)),
        d,
      ).toBe(true);
    }
  });
});

// The path list is derived from the code (AI-406): these fail when the app gains a dependency
// the gate doesn't know about.
describe("canAffectWebApp derivation", () => {
  const workspaceDirs = () =>
    ["apps", "packages"].flatMap((root) =>
      readdirSync(join(REPO, root), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `${root}/${e.name}`)
        .filter((dir) => {
          try {
            readFileSync(join(REPO, dir, "package.json"));
            return true;
          } catch {
            return false;
          }
        }),
    );
  const manifest = (dir) => JSON.parse(readFileSync(join(REPO, dir, "package.json"), "utf8"));
  const DEP_FIELDS = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];

  /** Workspace folders apps/web depends on, directly or through another workspace package. */
  function webClosure() {
    const byName = new Map(workspaceDirs().map((dir) => [manifest(dir).name, dir]));
    const seen = new Set();
    const queue = ["apps/web"];
    while (queue.length > 0) {
      const pkg = manifest(queue.shift());
      for (const field of DEP_FIELDS) {
        for (const [name, range] of Object.entries(pkg[field] ?? {})) {
          const dir = byName.get(name);
          if (!dir || !String(range).startsWith("workspace:") || seen.has(dir)) continue;
          seen.add(dir);
          queue.push(dir);
        }
      }
    }
    seen.delete("apps/web");
    return [...seen].sort();
  }

  it("GivenWorkspaceDependencyGraph_WhenWalkedFromTheWebApp_ThenTheGateKnowsEveryPackage", () => {
    expect(webClosure()).toEqual([...WEB_WORKSPACE_DEPS].sort());
  });

  it("GivenWorkspacePackageInTheClosure_WhenChanged_ThenRuns", () => {
    const closure = new Set(webClosure());
    for (const dir of workspaceDirs()) {
      if (dir === "apps/web" || closure.has(dir)) {
        expect(canAffectWebApp(`${dir}/src/x.ts`), dir).toBe(true);
      }
    }
  });

  it("GivenRelativeImportsLeavingTheWebAppsPackages_WhenScanned_ThenEachTargetIsCovered", () => {
    const dirs = ["apps/web", ...WEB_WORKSPACE_DEPS];
    const files = execFileSync("git", ["ls-files", ...dirs], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx|mts|mjs|js|cjs|css)$/.test(f));
    const IMPORT = /(?:from|import|@import|@source)\s*\(?\s*["'](\.{1,2}\/[^"'?]+)/g;
    const outside = new Set();
    for (const file of files) {
      const owner = dirs.find((d) => file.startsWith(`${d}/`));
      for (const m of readFileSync(join(REPO, file), "utf8").matchAll(IMPORT)) {
        const target = relative(REPO, normalize(join(REPO, dirname(file), m[1])));
        if (!target.startsWith(`${owner}/`)) outside.add(target);
      }
    }
    expect(outside.size).toBeGreaterThan(0); // apps/api imports platform/baseline today
    for (const target of outside) expect(canAffectWebApp(target), target).toBe(true);
  });

  it("GivenThePlaywrightWebServerCommand_WhenRead_ThenEveryScriptItRunsIsCovered", () => {
    const config = readFileSync(join(REPO, "apps/web/playwright.config.ts"), "utf8");
    const command = /command:\s*`([^`]+)`/.exec(config)?.[1] ?? "";
    const scripts = [...command.matchAll(/(?:^|\s)(\S+\.(?:mjs|js|ts))/g)].map((m) =>
      relative(REPO, normalize(join(REPO, "apps/web", m[1]))),
    );
    expect(scripts).toContain("scripts/gen-exports.mjs");
    for (const s of scripts) expect(canAffectWebApp(s), s).toBe(true);
    // Vite's config for the server, named by --config.
    const viteConfig = /--config\s+(\S+)/.exec(command)?.[1];
    expect(canAffectWebApp(`apps/web/${viteConfig}`)).toBe(true);
  });
});

describe("changedPaths", () => {
  it("GivenNoBaseRef_WhenRead_ThenThrows", () => {
    expect(() => changedPaths("")).toThrow();
  });

  it("GivenUnknownBaseRef_WhenGatedThroughGit_ThenRuns", () => {
    expect(gateOutput(() => changedPaths("no-such-ref-ai-358"))).toBe("run=true");
  });
});

// Dependabot bumps (AI-394): manifests and lockfiles only, every version within its major.
describe("isDependencyBump", () => {
  const pkg = (deps, extra = {}) =>
    JSON.stringify({ name: "x", ...extra, dependencies: deps }, null, 2);
  // read(side, path) over a map of { path: [baseText, headText] }; a missing side is null.
  const reader = (files) => (side, path) => files[path]?.[side === "base" ? 0 : 1] ?? null;
  // A pnpm v9 lockfile with the given "name@version" package keys.
  const lockOf = (...keys) =>
    `lockfileVersion: '9.0'\n\npackages:\n\n${keys.map((k) => `  '${k}':\n    resolution: {}\n`).join("\n")}\nsnapshots:\n\n  zzz@9.9.9:\n`;
  const lock = (base, head) => ({ "pnpm-lock.yaml": [lockOf(...base), lockOf(...head)] });

  it("GivenMinorAndPatchBumpsWithLockfile_WhenChecked_ThenTrue", () => {
    const read = reader({
      ...lock(["a@1.2.3", "@s/b@2.0.0"], ["a@1.9.0", "@s/b@2.0.5"]),
      "apps/web/package.json": [
        pkg({ a: "^1.2.3", b: "2.0.0", c: "~0.4.1" }),
        pkg({ a: "^1.9.0", b: "2.0.5", c: "~0.4.7" }),
      ],
    });
    expect(isDependencyBump(["apps/web/package.json", "pnpm-lock.yaml", ""], read)).toBe(true);
  });

  it("GivenLockfileOnlyMinorBump_WhenChecked_ThenTrue", () => {
    const read = reader(
      lock(
        ["a@1.2.3", "a@2.0.0", "@s/b@0.4.1", "gone@1.0.0"],
        ["a@1.3.0", "a@2.0.0", "@s/b@0.4.9"],
      ),
    );
    expect(isDependencyBump(["pnpm-lock.yaml"], read)).toBe(true);
  });

  it("GivenLockfileMajorBump_WhenChecked_ThenFalse", () => {
    expect(isDependencyBump(["pnpm-lock.yaml"], reader(lock(["a@1.2.3"], ["a@2.0.0"])))).toBe(
      false,
    );
    expect(isDependencyBump(["pnpm-lock.yaml"], reader(lock(["a@0.4.1"], ["a@0.5.0"])))).toBe(
      false,
    );
  });

  it("GivenLockfileAddsPackage_WhenChecked_ThenFalse", () => {
    expect(
      isDependencyBump(["pnpm-lock.yaml"], reader(lock(["a@1.2.3"], ["a@1.2.3", "evil@1.0.0"]))),
    ).toBe(false);
  });

  it("GivenLockfileNonSemverResolution_WhenChecked_ThenFalse", () => {
    const read = reader(lock(["a@1.2.3"], ["a@https://example.com/a.tgz"]));
    expect(isDependencyBump(["pnpm-lock.yaml"], read)).toBe(false);
  });

  it("GivenUnreadableOrNonPnpmLockfile_WhenChecked_ThenFalse", () => {
    expect(
      isDependencyBump(["pnpm-lock.yaml"], reader({ "pnpm-lock.yaml": ["x: 1", "x: 2"] })),
    ).toBe(false);
    expect(
      isDependencyBump(["package-lock.json"], reader({ "package-lock.json": ["{}", "{}"] })),
    ).toBe(false);
    expect(isDependencyBump(["yarn.lock"], reader({ "yarn.lock": ["", ""] }))).toBe(false);
  });

  it("GivenRangeOperatorChanged_WhenChecked_ThenFalse", () => {
    const widened = reader({ "package.json": [pkg({ a: "^1.2.3" }), pkg({ a: ">=1.2.3" })] });
    expect(isDependencyBump(["package.json"], widened)).toBe(false);
    const loosened = reader({ "package.json": [pkg({ a: "1.2.3" }), pkg({ a: "^1.2.4" })] });
    expect(isDependencyBump(["package.json"], loosened)).toBe(false);
  });

  it("GivenMajorBump_WhenChecked_ThenFalse", () => {
    const read = reader({
      "package.json": [pkg({ "web-push": "^3.6.7" }), pkg({ "web-push": "^4.0.0" })],
    });
    expect(isDependencyBump(["package.json"], read)).toBe(false);
  });

  it("GivenZeroMajorMinorBump_WhenChecked_ThenFalse", () => {
    const read = reader({ "package.json": [pkg({ a: "^0.4.1" }), pkg({ a: "^0.5.0" })] });
    expect(isDependencyBump(["package.json"], read)).toBe(false);
  });

  it("GivenNonSemverRange_WhenChanged_ThenFalse", () => {
    const read = reader({ "package.json": [pkg({ a: "^1.0.0" }), pkg({ a: "github:evil/a" })] });
    expect(isDependencyBump(["package.json"], read)).toBe(false);
    const pre = reader({ "package.json": [pkg({ a: "1.0.0" }), pkg({ a: "1.1.0-beta.1" })] });
    expect(isDependencyBump(["package.json"], pre)).toBe(false);
  });

  it("GivenScriptsOrOverridesChanged_WhenChecked_ThenFalse", () => {
    const scripts = reader({
      "package.json": [
        pkg({ a: "1.0.0" }, { scripts: { test: "vitest" } }),
        pkg({ a: "1.0.1" }, { scripts: { test: "curl x | sh" } }),
      ],
    });
    expect(isDependencyBump(["package.json"], scripts)).toBe(false);
    const overrides = reader({
      "package.json": [
        pkg({ a: "1.0.0" }),
        pkg({ a: "1.0.0" }, { pnpm: { overrides: { b: "1.0.0" } } }),
      ],
    });
    expect(isDependencyBump(["package.json"], overrides)).toBe(false);
  });

  it("GivenDependencyAddedOrRemoved_WhenChecked_ThenFalse", () => {
    const added = reader({
      "package.json": [pkg({ a: "1.0.0" }), pkg({ a: "1.0.0", b: "1.0.0" })],
    });
    expect(isDependencyBump(["package.json"], added)).toBe(false);
    const removed = reader({
      "package.json": [pkg({ a: "1.0.0", b: "1.0.0" }), pkg({ a: "1.0.0" })],
    });
    expect(isDependencyBump(["package.json"], removed)).toBe(false);
  });

  it("GivenNewOrDeletedManifest_WhenChecked_ThenFalse", () => {
    expect(
      isDependencyBump(
        ["packages/new/package.json"],
        reader({ "packages/new/package.json": [null, pkg({})] }),
      ),
    ).toBe(false);
  });

  it("GivenAlwaysReviewedFolders_WhenChecked_ThenFalse", () => {
    for (const path of [
      ".github/package.json",
      "infra/x/package.json",
      "platform/actions/x/package-lock.json",
      "template/starter/package.json",
    ]) {
      expect(isDependencyBump([path], reader({ [path]: [pkg({}), pkg({})] }))).toBe(false);
    }
  });

  it("GivenAnyOtherFile_WhenChecked_ThenFalse", () => {
    expect(isDependencyBump(["pnpm-lock.yaml", "apps/web/src/App.tsx"], reader({}))).toBe(false);
    expect(isDependencyBump(["pnpm-lock.yaml", ".npmrc"], reader({}))).toBe(false);
    expect(isDependencyBump(["pnpm-lock.yaml", "pnpm-workspace.yaml"], reader({}))).toBe(false);
  });

  it("GivenNoFiles_WhenChecked_ThenFalse", () => {
    expect(isDependencyBump([""], reader({}))).toBe(false);
  });
});

describe("dependencyBumpOutput", () => {
  // AI-394 criterion 3: on a person-started run (the action only asks this file then), a major
  // bump or a change under infra/, .github/, platform/ or template/ is not a bump, so the action
  // keeps mode=review and both agents run. Dependabot-started runs skip earlier (no secrets).
  it("GivenPersonStartedRunOnMajorOrProtectedFolderChange_WhenChecked_ThenAgentsRun", () => {
    const pkg = (v) => JSON.stringify({ name: "x", dependencies: { a: v } });
    const lockOf = (k) => `lockfileVersion: '9.0'\n\npackages:\n\n  ${k}:\n    resolution: {}\n`;
    const files = {
      "package.json": [pkg("^1.2.3"), pkg("^2.0.0")],
      "pnpm-lock.yaml": [lockOf("a@1.2.3"), lockOf("a@2.0.0")],
    };
    const read = (side, path) => files[path]?.[side === "base" ? 0 : 1] ?? pkg("1.0.0");
    expect(dependencyBumpOutput(() => ["package.json", "pnpm-lock.yaml"], read)).toBe("false");
    for (const folder of [
      "infra/dns/x.tf",
      ".github/workflows/ci.yml",
      "platform/actions/a/action.yml",
      "template/starter/package.json",
    ]) {
      // The lockfile part alone is a minor bump, so the folder is what brings the agents back.
      const minor = (side, path) =>
        path === "pnpm-lock.yaml" ? lockOf(side === "base" ? "a@1.2.3" : "a@1.3.0") : pkg("^1.0.0");
      expect(dependencyBumpOutput(() => ["pnpm-lock.yaml"], minor)).toBe("true");
      expect(dependencyBumpOutput(() => ["pnpm-lock.yaml", folder], minor)).toBe("false");
    }
  });

  it("GivenUnparsableManifest_WhenChecked_ThenFalse", () => {
    const read = () => "{ not json";
    expect(dependencyBumpOutput(() => ["package.json"], read)).toBe("false");
  });

  it("GivenDetectionThrows_WhenChecked_ThenFalse", () => {
    const list = () => {
      throw new Error("git failed");
    };
    expect(dependencyBumpOutput(list, () => null)).toBe("false");
  });

  it("GivenUnknownBaseRef_WhenCheckedThroughGit_ThenFalse", () => {
    expect(dependencyBumpOutput(() => changedPaths("no-such-ref-ai-394"), fileAt)).toBe("false");
  });

  it("GivenUnknownRef_WhenFileRead_ThenNull", () => {
    expect(fileAt("no-such-ref-ai-394", "package.json")).toBeNull();
  });
});

describe("lockedPackages", () => {
  it("GivenPnpmV9Lockfile_WhenRead_ThenOnlyPackagesSectionKeys", () => {
    const text =
      "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    x: 1\n\npackages:\n\n  '@playwright/test@1.65.1':\n    resolution: {}\n\n  vitest@5.1.1:\n    resolution: {}\n\nsnapshots:\n\n  other@1.0.0: {}\n";
    const packages = lockedPackages(text);
    expect([...packages.keys()]).toEqual(["@playwright/test", "vitest"]);
    expect([...packages.get("vitest")]).toEqual(["5.1.1"]);
  });
});
