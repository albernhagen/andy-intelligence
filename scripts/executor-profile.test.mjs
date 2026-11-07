import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE,
  buildProfile,
  codeownersPatterns,
  toRulePaths,
} from "./executor-profile.mjs";

const profile = JSON.parse(readFileSync(DEFAULT_PROFILE, "utf8"));
const ROOT = "/work/proj";
const build = (step, codeowners = "") => buildProfile({ profile, step, codeowners, root: ROOT });

describe("buildProfile", () => {
  it("GivenAnyStep_WhenBuilt_ThenEnvFileReadsAreDenied", () => {
    for (const step of Object.keys(profile.steps)) {
      const { deny } = build(step).permissions;
      expect(deny).toContain("Read(//**/.env)");
      expect(deny).toContain("Read(//**/.env.*)");
    }
  });

  it("GivenAnyStep_WhenBuilt_ThenProcessEnvironmentAndRunnerFilesAreDenied", () => {
    // The model credential is in the agent's process environment (security review on PR #51).
    for (const step of Object.keys(profile.steps)) {
      const { deny } = build(step).permissions;
      for (const rule of [
        "Read(//proc/**)",
        "Read(//sys/**)",
        "Read(//etc/**)",
        "Read(//home/runner/work/_temp/**)",
        "Read(//home/runner/.config/**)",
      ]) {
        expect(deny).toContain(rule);
      }
    }
  });

  it("GivenAnyStep_WhenBuilt_ThenTfvarsStateAndCredentialReadsAreDenied", () => {
    const { deny } = build("build").permissions;
    for (const rule of [
      "Read(//**/*.tfvars)",
      "Read(//**/*.tfstate)",
      "Read(//**/.terraform/**)",
      "Read(~/.ssh/**)",
      "Read(~/.config/gcloud/**)",
      "Read(~/.claude/.credentials.json)",
    ])
      expect(deny).toContain(rule);
  });

  it("GivenCodeownersPath_WhenBuilt_ThenItBecomesAnEditDeny", () => {
    const { deny } = build("build", "/infra/ @andy\n").permissions;
    expect(deny).toContain("Edit(//work/proj/infra/**)");
  });

  it("GivenRefine_WhenBuilt_ThenNoEditWriteOrBashAllowed", () => {
    const { allow, deny } = build("refine").permissions;
    expect(allow).toEqual(["Read", "Glob", "Grep"]);
    for (const tool of ["Bash", "Edit", "Write", "MultiEdit"]) {
      expect(allow.some((rule) => rule === tool || rule.startsWith(`${tool}(`))).toBe(false);
      expect(deny).toContain(tool);
    }
  });

  it("GivenBuild_WhenBuilt_ThenEditsAndBashAreAllowedOnlyInsideTheSandbox", () => {
    const settings = build("build");
    expect(settings.permissions.allow).toEqual(expect.arrayContaining(["Edit", "Write", "Bash"]));
    expect(settings.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: ["registry.npmjs.org"], strictAllowlist: true },
    });
  });

  it("GivenBuild_WhenBuilt_ThenTheCheckoutAndItsGitDirStayWritableInTheSandbox", () => {
    // A denyWrite on .git made every Bash call fail (AI-42): Claude Code's sandbox protects
    // .git/config and .git/hooks itself, and git needs .git/index and its lock files.
    const { filesystem } = build("build").sandbox;
    expect(filesystem.denyWrite ?? []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^\/work\/proj(\/\.git)?$/)]),
    );
    expect(filesystem.allowWrite).toEqual(["/tmp/agent"]);
  });

  it("GivenBuild_WhenBuilt_ThenSandboxedCommandsCanReadTheCaCertificatesButTheReadToolCantReadEtc", () => {
    // Read denies become sandbox denyReads; Read(//etc/**) hid /etc/ssl from curl (AI-51).
    const settings = build("build");
    expect(settings.sandbox.filesystem.allowRead).toEqual([
      "/etc/ssl/certs",
      "/etc/ssl/openssl.cnf",
      "/etc/ca-certificates",
      "/etc/alternatives",
    ]);
    expect(settings.permissions.deny).toContain("Read(//etc/**)");
  });

  it("GivenBuild_WhenBuilt_ThenThePathsThatSteerGitAreWriteDeniedAndGitsWorkingFilesAreNot", () => {
    const { denyWrite } = build("build").sandbox.filesystem;
    const git = "/work/proj/.git";
    expect(denyWrite).toEqual(
      [
        "commondir",
        "config.worktree",
        "HEAD",
        "packed-refs",
        "refs",
        "info",
        "objects/info",
        "modules",
        "worktrees",
      ].map((p) => `${git}/${p}`),
    );
    for (const writable of ["index", "index.lock", "objects", "logs"]) {
      expect(denyWrite.some((d) => `${git}/${writable}`.startsWith(d))).toBe(false);
    }
  });

  it("GivenBuild_WhenBuilt_ThenModelAndGitHubCredentialsAreUnsetForBash", () => {
    const names = build("build").sandbox.credentials.envVars.map((v) => `${v.name}:${v.mode}`);
    for (const name of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) {
      expect(names).toContain(`${name}:deny`);
    }
  });

  it("GivenReadOnlySteps_WhenBuilt_ThenNoSandboxIsNeeded", () => {
    expect(build("refine").sandbox).toBeUndefined();
  });

  it("GivenTheCatchAllCodeownersLine_WhenBuilt_ThenOnlyTheLinesAfterItBecomeEditDenies", () => {
    const { deny } = build("build", "* @andy\n/infra/ @andy\n").permissions;
    expect(deny).not.toContain("Edit(//work/proj/**)");
    expect(deny).toContain("Edit(//work/proj/infra/**)");
  });

  it("GivenAnyStep_WhenBuilt_ThenBypassPermissionsModeIsDisabled", () => {
    expect(build("plan").permissions.disableBypassPermissionsMode).toBe("disable");
  });

  it("GivenAnyStep_WhenBuilt_ThenProjectHooksDoNotRun", () => {
    const settings = build("build");
    expect(settings.allowManagedHooksOnly).toBe(true);
    expect(settings.disableAllHooks).toBe(true);
  });

  it("GivenAnyStep_WhenBuilt_ThenOnlyManagedPermissionRulesAndNoProjectMcpServers", () => {
    const settings = build("review");
    expect(settings.allowManagedPermissionRulesOnly).toBe(true);
    expect(settings.allowManagedMcpServersOnly).toBe(true);
    expect(settings.allowedMcpServers).toEqual([]);
  });

  it("GivenAnyStep_WhenBuilt_ThenTrustAnchorEditsAreDenied", () => {
    const { deny } = build("build").permissions;
    for (const rule of [
      "Edit(//**/.github/**)",
      "Edit(//**/platform/actions/**)",
      "Edit(//**/scripts/review-*.mjs)",
      "Edit(//**/CODEOWNERS)",
      "Edit(//**/platform/executor/**)",
      "Edit(//**/.claude/**)",
      "Edit(//**/.git/**)",
    ])
      expect(deny).toContain(rule);
  });

  it("GivenUnknownStep_WhenBuilt_ThenThrows", () => {
    expect(() => build("deploy")).toThrow(/unknown step/);
    expect(() => build("toString")).toThrow(/unknown step/);
  });

  it("GivenTwoBuilds_WhenBuilt_ThenBaseProfileIsNotMutated", () => {
    build("build", "*.ts @andy");
    expect(build("refine").permissions.deny.some((r) => r.includes("*.ts"))).toBe(false);
  });
});

describe("codeownersPatterns", () => {
  it("GivenCommentsBlanksAndOwnerlessLines_WhenParsed_ThenOnlyOwnedPatterns", () => {
    const text = "# owners\n\n*.js @a @b\n/docs/ @org/team # inline\nunowned.txt\n  \n";
    expect(codeownersPatterns(text)).toEqual(["*.js", "/docs/"]);
  });

  it("GivenEscapedSpaceAndHash_WhenParsed_ThenUnescaped", () => {
    expect(codeownersPatterns("my\\ file.txt @a\n\\#notes @b\n")).toEqual([
      "my file.txt",
      "#notes",
    ]);
  });
});

describe("toRulePaths", () => {
  it("GivenLeadingSlash_WhenConverted_ThenAnchoredAtRoot", () => {
    expect(toRulePaths("/package.json", ROOT)).toEqual([
      "//work/proj/package.json",
      "//work/proj/package.json/**",
    ]);
  });

  it("GivenNoSlash_WhenConverted_ThenAnyDepth", () => {
    expect(toRulePaths("*.tf", ROOT)).toEqual(["//work/proj/**/*.tf", "//work/proj/**/*.tf/**"]);
  });

  it("GivenTrailingSlash_WhenConverted_ThenDirectoryContents", () => {
    expect(toRulePaths("apps/", ROOT)).toEqual(["//work/proj/**/apps/**"]);
    expect(toRulePaths("/infra/", ROOT)).toEqual(["//work/proj/infra/**"]);
  });

  it("GivenMiddleSlash_WhenConverted_ThenAnchoredAtRoot", () => {
    expect(toRulePaths("docs/security", ROOT)).toEqual([
      "//work/proj/docs/security",
      "//work/proj/docs/security/**",
    ]);
  });

  it("GivenGlobSuffixes_WhenConverted_ThenKeptAsIs", () => {
    expect(toRulePaths("docs/*", ROOT)).toEqual(["//work/proj/docs/*"]);
    expect(toRulePaths("/apps/**", ROOT)).toEqual(["//work/proj/apps/**"]);
    expect(toRulePaths("**/logs", ROOT)).toEqual(["//work/proj/**/logs", "//work/proj/**/logs/**"]);
  });

  it("GivenStar_WhenConverted_ThenWholeRepo", () => {
    expect(toRulePaths("*", ROOT)).toEqual(["//work/proj/**"]);
  });
});

describe("CLI", () => {
  const script = join(import.meta.dirname, "executor-profile.mjs");
  const dir = mkdtempSync(join(tmpdir(), "executor-profile-"));

  it("GivenStepAndCodeowners_WhenRun_ThenWritesManagedSettings", () => {
    const codeowners = join(dir, "CODEOWNERS");
    writeFileSync(codeowners, "/infra/ @andy\n");
    const out = join(dir, "managed-settings.json");
    const result = spawnSync(
      process.execPath,
      [script, "--step", "plan", "--codeowners", codeowners, "--root", ROOT, "--out", out],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const settings = JSON.parse(readFileSync(out, "utf8"));
    expect(settings.permissions.deny).toContain("Edit(//work/proj/infra/**)");
    expect(settings.steps).toBeUndefined();
  });

  it("GivenMissingCodeowners_WhenRun_ThenNoExtraRules", () => {
    const out = join(dir, "no-codeowners.json");
    const result = spawnSync(
      process.execPath,
      [script, "--step", "refine", "--codeowners", join(dir, "nope"), "--root", ROOT, "--out", out],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const { deny } = JSON.parse(readFileSync(out, "utf8")).permissions;
    expect(deny.some((rule) => rule.includes("//work/proj"))).toBe(false);
  });

  it("GivenUnknownStep_WhenRun_ThenExitsNonZero", () => {
    const result = spawnSync(
      process.execPath,
      [script, "--step", "deploy", "--out", join(dir, "x.json")],
      {
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unknown step");
  });
});
