import { Buffer } from "node:buffer";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "./executor-profile.mjs";
import {
  GitError,
  MAX_BODY,
  PublishRefused,
  gitRunner,
  oneLine,
  publish,
  toolingFiles,
  MAX_CHANGED_FILES,
  checkChange,
  dropSandboxPlaceholders,
  sandboxPlaceholders,
  SANDBOX_PLACEHOLDERS,
  globToRegExp,
  neutralize,
  parseRaw,
  protectedGlobs,
  pullRequest,
} from "./executor-publish.mjs";

const profile = JSON.parse(readFileSync(DEFAULT_PROFILE, "utf8"));
const OWNERS = "* @andy\n/infra/ @andy\npayments.ts @andy\n";
const globs = protectedGlobs(profile, OWNERS);
const entry = (path, dstMode = "100644", srcMode = "000000") => ({
  srcMode,
  dstMode,
  status: "A",
  path,
});

const output = {
  summary: "Adds the board. cc @someone",
  plan: {
    files: ["apps/web/src/pages/BoardPage.tsx"],
    steps: ["Write the page", "Test it"],
    tests: ["GivenTickets_WhenTheBoardOpens_ThenTheyShow"],
    riskiestStep: "Ordering by rank",
    rejectedAlternatives: ["A table"],
  },
  deviations: [],
  verification: [{ command: "pnpm test", passed: true, output: "12 passed\n```\nbreak" }],
  failingTestFiles: [],
};
const pr = (report) =>
  pullRequest({
    controlPlaneUrl: "https://ai.andybernhagen.com",
    projectId: "ai",
    ticketKey: "AI-3",
    ticketTitle: "M1.8a: Build run",
    runId: "run1",
    model: "sonnet",
    report,
  });

describe("executor publish", () => {
  it("GivenTheProfileAndCodeowners_WhenGlobsAreBuilt_ThenTrustAnchorsAndOwnedPathsButNotTheCatchAll", () => {
    expect(globs).toEqual(
      expect.arrayContaining([
        "**/.github/**",
        "**/platform/actions/**",
        "**/scripts/review-*.mjs",
        "**/infra/**",
        "**/.terraform-version",
        "**/.mcp.json",
        "**/CODEOWNERS",
        "**/platform/executor/**",
        "**/.claude/**",
        "infra/**",
        "**/payments.ts",
      ]),
    );
    expect(globs).not.toContain("**/*");
  });

  it("GivenGlobs_WhenMatched_ThenDoubleStarCrossesDirectoriesAndStarDoesNot", () => {
    expect(globToRegExp("**/.github/**").test(".github/workflows/ci.yml")).toBe(true);
    expect(globToRegExp("**/CODEOWNERS").test("docs/CODEOWNERS")).toBe(true);
    expect(globToRegExp("infra/**").test("infra/main.tf")).toBe(true);
    expect(globToRegExp("infra/**").test("apps/infra/main.tf")).toBe(false);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
  });

  it("GivenAnOrdinaryChange_WhenChecked_ThenItPasses", () => {
    expect(checkChange([entry("apps/web/src/a.ts"), entry("README.md")], globs)).toEqual([]);
  });

  it("GivenAWorkflowEditMadeThroughBash_WhenChecked_ThenItIsRefused", () => {
    expect(checkChange([entry(".github/workflows/ci.yml")], globs)).toEqual([
      ".github/workflows/ci.yml: protected (**/.github/**)",
    ]);
  });

  it("GivenCodeThatPrJobsRunWithCredentials_WhenChecked_ThenItIsRefused", () => {
    const paths = [
      "infra/control-plane/main.tf",
      ".terraform-version",
      ".mcp.json",
      "platform/actions/x/action.yml",
      "scripts/review-gate.mjs",
    ];
    expect(
      checkChange(
        paths.map((p) => entry(p)),
        globs,
      ),
    ).toHaveLength(paths.length);
    expect(
      checkChange([entry("scripts/executor-publish.mjs"), entry("apps/api/src/app.ts")], globs),
    ).toEqual([]);
  });

  it("GivenOwnedPathsSymlinksAndSubmodules_WhenChecked_ThenEachIsRefused", () => {
    const reasons = checkChange(
      [entry("infra/main.tf"), entry("link", "120000"), entry("vendor/x", "160000")],
      globs,
    );
    expect(reasons).toHaveLength(3);
  });

  it("GivenAnEmptyOrHugeChange_WhenChecked_ThenItIsRefused", () => {
    expect(checkChange([], globs)).toEqual(["the change is empty"]);
    const many = Array.from({ length: MAX_CHANGED_FILES + 1 }, (_, i) => entry(`f${i}.ts`));
    expect(checkChange(many, globs)[0]).toContain("cap is");
  });

  it("GivenRawDiffOutput_WhenParsed_ThenModesAndPathsAreRead", () => {
    const raw =
      ":000000 100644 0000000 abc1234 A\0src/a b.ts\0:100644 000000 abc1234 0000000 D\0old.ts\0";
    expect(parseRaw(raw)).toEqual([
      { srcMode: "000000", dstMode: "100644", status: "A", path: "src/a b.ts" },
      { srcMode: "100644", dstMode: "000000", status: "D", path: "old.ts" },
    ]);
  });

  it("GivenAReport_WhenThePrIsWritten_ThenTheDescriptionStartsWithTheTicketLinkAndHasEverySection", () => {
    const { title, body } = pr({ status: "succeeded", output });
    expect(title).toBe("AI-3: M1.8a: Build run");
    expect(body.split("\n")[0]).toBe("https://ai.andybernhagen.com/p/ai/t/AI-3");
    for (const section of [
      "## Summary",
      "## Plan",
      "## Deviations from the plan",
      "## Verification",
    ]) {
      expect(body).toContain(section);
    }
    expect(body).toContain("**Riskiest step:** Ordering by rank");
  });

  it("GivenAgentTextWithMentionsAndFences_WhenThePrIsWritten_ThenNeitherSurvives", () => {
    const { body } = pr({ status: "succeeded", output });
    expect(body).not.toMatch(/@someone/);
    expect(body).not.toContain("```\nbreak");
    expect(neutralize("@a ~~~ b")).not.toMatch(/@a|~~~/);
  });

  it("GivenAHugeReportOrAMultiLineTitle_WhenThePrIsWritten_ThenBothAreCapped", () => {
    const long = { ...output, summary: "x".repeat(MAX_BODY) };
    expect(pr({ status: "succeeded", output: long }).body.length).toBeLessThanOrEqual(MAX_BODY);
    const titled = pullRequest({ ticketKey: "AI-3", ticketTitle: "a\nb", report: null });
    expect(titled.title).toBe("AI-3: a b");
  });
});

describe("executor publish job", () => {
  const raw = (...paths) => paths.map((p) => `:000000 100644 0000000 abc1234 A\0${p}\0`).join("");
  const baseEnv = {
    PATCH: "/tmp/change.patch",
    PROFILE: DEFAULT_PROFILE,
    CODEOWNERS: "",
    RUN_ID: "run1",
    BRANCH: "agent/AI-3/run1",
    REPO: "albernhagen/andy-intelligence",
    BASE: "main",
    PROJECT_ID: "ai",
    TICKET_KEY: "AI-3",
    TICKET_TITLE: "Build run",
    MODEL: "sonnet",
    REPORT: JSON.stringify({ status: "succeeded", output }),
    CONTROL_PLANE_URL: "https://ai.andybernhagen.com",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example/token?x=1",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req",
  };
  function harness(paths = ["apps/web/src/a.ts"], { tokenStatus = 200 } = {}) {
    const calls = [];
    const git = (args, env = {}) => {
      calls.push({ args, env });
      if (args.includes("--raw")) return raw(...paths);
      if (args.includes("--name-only")) return "staged\n";
      return "";
    };
    const requests = [];
    const reply = (status, body) => ({
      ok: status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    const fetch = async (url, init = {}) => {
      requests.push({ url, init });
      const { origin, pathname } = new URL(url);
      if (origin === "https://actions.example") return reply(200, { value: "oidc-jwt" });
      if (origin === "https://ai.andybernhagen.com" && pathname === "/github/token") {
        return reply(tokenStatus, { token: "ghs_secret" });
      }
      return reply(201, { html_url: "https://github.com/albernhagen/andy-intelligence/pull/90" });
    };
    const lines = [];
    const outputs = {};
    const run = (env = baseEnv) =>
      publish({
        env,
        git,
        fetch,
        emit: (l) => lines.push(l),
        output: (k, v) => (outputs[k] = v),
      });
    return { calls, requests, lines, outputs, run };
  }
  const pushed = (calls) => calls.find((c) => c.args[0] === "push");

  it("GivenAnOrdinaryChange_WhenPublished_ThenItPushesWithTheTokenInEnvOnlyAndOpensThePr", async () => {
    const h = harness();
    const result = await h.run();
    expect(result.pullRequest).toBe("https://github.com/albernhagen/andy-intelligence/pull/90");
    const push = pushed(h.calls);
    expect(push.args.join(" ")).not.toContain("ghs_secret");
    expect(push.env.GIT_CONFIG_VALUE_0).toContain(
      Buffer.from("x-access-token:ghs_secret").toString("base64"),
    );
    expect(h.lines.filter((l) => l.includes("ghs_secret"))).toEqual(["::add-mask::ghs_secret"]);
    expect(h.lines.join("\n")).not.toContain("Build run");
    const body = JSON.parse(h.requests.at(-1).init.body);
    expect(body).toMatchObject({ title: "AI-3: Build run", head: "agent/AI-3/run1", base: "main" });
    expect(body.body.split("\n")[0]).toBe("https://ai.andybernhagen.com/p/ai/t/AI-3");
    expect(h.outputs).toMatchObject({ branch: "agent/AI-3/run1", tooling_files: "[]" });
  });

  it("GivenAProtectedPath_WhenPublished_ThenItIsRefusedBeforeAnyTokenOrPush", async () => {
    const h = harness(["infra/control-plane/main.tf"]);
    await expect(h.run()).rejects.toBeInstanceOf(PublishRefused);
    expect(pushed(h.calls)).toBeUndefined();
    expect(h.requests).toEqual([]);
  });

  it("GivenABadBranchOrRepo_WhenPublished_ThenItIsRefusedBeforeGitRuns", async () => {
    const h = harness();
    await expect(h.run({ ...baseEnv, BRANCH: "main" })).rejects.toBeInstanceOf(PublishRefused);
    await expect(h.run({ ...baseEnv, REPO: "a b" })).rejects.toBeInstanceOf(PublishRefused);
    expect(h.calls).toEqual([]);
  });

  it("GivenTheTokenIsRefused_WhenPublished_ThenNothingIsPushed", async () => {
    const h = harness(["a.ts"], { tokenStatus: 403 });
    await expect(h.run()).rejects.toThrow("POST /github/token returned HTTP 403");
    expect(pushed(h.calls)).toBeUndefined();
  });

  it("GivenAFailedAgent_WhenPublished_ThenTheBranchIsPushedButNoPrOpens", async () => {
    const h = harness();
    const result = await h.run({ ...baseEnv, REPORT: JSON.stringify({ status: "failed" }) });
    expect(result.pullRequest).toBeNull();
    expect(pushed(h.calls)).toBeDefined();
    expect(h.requests.map((r) => new URL(r.url).pathname)).not.toContain(
      "/repos/albernhagen/andy-intelligence/pulls",
    );
  });

  it("GivenToolingFiles_WhenPublished_ThenThePrSaysSoRightAfterTheTicketLinkAndTheOutputListsThem", async () => {
    const h = harness(["package.json", "apps/web/vite.config.ts", "src/a.ts"]);
    await h.run();
    const body = JSON.parse(h.requests.at(-1).init.body).body.split("\n");
    expect(body[0]).toBe("https://ai.andybernhagen.com/p/ai/t/AI-3");
    expect(body[2]).toContain("Changes tooling or dependency files");
    expect(JSON.parse(h.outputs.tooling_files)).toEqual([
      "package.json",
      "apps/web/vite.config.ts",
    ]);
  });

  it("GivenABugTicket_WhenPublished_ThenTheFailingTestIsAddedLiterallyAndCommittedFirst", async () => {
    const h = harness(["test/a.test.ts", "src/a.ts"]);
    const report = { status: "succeeded", output: { ...output, failingTestFiles: [":(glob)**"] } };
    await h.run({ ...baseEnv, REPORT: JSON.stringify(report) });
    const add = h.calls.find((c) => c.args[0] === "--literal-pathspecs");
    expect(add.args).toEqual(["--literal-pathspecs", "add", "--", ":(glob)**"]);
    const commits = h.calls.filter((c) => c.args[0] === "commit").map((c) => c.args[3]);
    expect(commits).toEqual(["AI-3: Build run: failing test", "AI-3: Build run"]);
  });

  it("GivenAMalformedAgentOutput_WhenThePrIsWritten_ThenItFallsBackInsteadOfCrashing", () => {
    const { body } = pr({ status: "succeeded", summary: "s", output: { plan: null } });
    expect(body).toContain("None: the run returned no structured result.");
  });

  it("GivenAGitCommitThatFails_WhenReported_ThenTheTitleAndArgumentsAreNotInTheMessage", () => {
    const dir = mkdtempSync(join(tmpdir(), "publish-git-"));
    const git = gitRunner(dir);
    const title = "AI-3: RecognisableSecretTitle";
    let error;
    try {
      git(["commit", "-q", "-m", title, "-m", "Agent-Run: run1"]);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(GitError);
    expect(error.message).toMatch(/^git commit failed \(exit \d+\)/);
    expect(error.message).not.toContain("RecognisableSecretTitle");
    expect(error.message).not.toContain("Agent-Run");
  });

  it("GivenAgentTextWithNewlinesAndWorkflowCommands_WhenLogged_ThenItStaysOnOneLine", () => {
    expect(oneLine("a.ts\n::add-mask::x")).toBe("a.ts : :add-mask: :x");
  });

  it("GivenToolingPaths_WhenClassified_ThenConfigsLockfilesAndManifestsMatchAndCodeDoesNot", () => {
    const paths = [
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.base.json",
      "vitest.config.ts",
      ".gitattributes",
      "lefthook.yml",
      "src/config.ts",
    ];
    expect(toolingFiles(paths.map((p) => entry(p)))).toEqual(paths.slice(0, 6));
  });
});

describe("sandbox placeholders", () => {
  const sizes = (files) => (path) => (path in files ? { file: true, size: files[path] } : null);

  it("GivenZeroByteYarnLockAndNpmrcTheSandboxCreated_WhenCollected_ThenBothAreDropped", () => {
    const stat = sizes({ "yarn.lock": 0, ".npmrc": 0, "scripts/probe.mjs": 120 });
    expect(sandboxPlaceholders({ before: new Set(), stat })).toEqual([".npmrc", "yarn.lock"]);
  });

  it("GivenARealYarnLockTheAgentWrote_WhenCollected_ThenItIsKept", () => {
    const stat = sizes({ "yarn.lock": 2048 });
    expect(sandboxPlaceholders({ before: new Set(), stat })).toEqual([]);
  });

  it("GivenAnEmptyListedFileThatExistedBeforeTheAgent_WhenCollected_ThenItIsKept", () => {
    const stat = sizes({ ".npmrc": 0 });
    expect(sandboxPlaceholders({ before: new Set([".npmrc"]), stat })).toEqual([]);
  });

  it("GivenAnEmptyFileNotOnTheSandboxList_WhenCollected_ThenItIsKept", () => {
    const stat = sizes({ "src/empty.ts": 0, ".gitkeep": 0 });
    expect(sandboxPlaceholders({ before: new Set(), stat })).toEqual([]);
  });

  it("GivenTheSevenPlaceholdersOfTheFailedProof_WhenCollected_ThenAllAreDropped", () => {
    const seen = [
      ".gitmodules",
      ".npmrc",
      ".yarnrc",
      ".yarnrc.yml",
      "bunfig.toml",
      "package-lock.json",
      "yarn.lock",
    ];
    const stat = sizes(Object.fromEntries(seen.map((p) => [p, 0])));
    expect(sandboxPlaceholders({ before: new Set(), stat }).sort()).toEqual([...seen].sort());
  });

  it("GivenAWorkspace_WhenPlaceholdersAreDropped_ThenOnlyTheNewEmptyListedFilesAreDeletedAndLogged", () => {
    const root = mkdtempSync(join(tmpdir(), "placeholders-"));
    writeFileSync(join(root, "yarn.lock"), "");
    writeFileSync(join(root, ".npmrc"), "");
    writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}');
    writeFileSync(join(root, ".yarnrc"), "");
    symlinkSync("/etc/hostname", join(root, "bunfig.toml"));
    const manifest = join(root, "..", `${basename(root)}.manifest`);
    writeFileSync(manifest, ".yarnrc\0README.md\0");
    const lines = [];
    const dropped = dropSandboxPlaceholders({ root, manifest, emit: (l) => lines.push(l) });
    expect(dropped).toEqual([".npmrc", "yarn.lock"]);
    expect(existsSync(join(root, "yarn.lock"))).toBe(false);
    expect(existsSync(join(root, ".npmrc"))).toBe(false);
    expect(existsSync(join(root, "package-lock.json"))).toBe(true);
    expect(existsSync(join(root, ".yarnrc"))).toBe(true);
    expect(lstatSync(join(root, "bunfig.toml")).isSymbolicLink()).toBe(true);
    expect(lines).toEqual([
      "Dropped sandbox placeholder .npmrc (empty, not there before the agent).",
      "Dropped sandbox placeholder yarn.lock (empty, not there before the agent).",
    ]);
  });

  it("GivenDotClaudeIsASymlinkToAnOutsideDir_WhenPlaceholdersAreDropped_ThenTheFileThereSurvives", () => {
    const root = mkdtempSync(join(tmpdir(), "placeholders-"));
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "settings.json"), "");
    symlinkSync(outside, join(root, ".claude"));
    const manifest = join(root, "..", `${basename(root)}.manifest`);
    writeFileSync(manifest, "");
    expect(dropSandboxPlaceholders({ root, manifest, emit: () => {} })).toEqual([]);
    expect(existsSync(join(outside, "settings.json"))).toBe(true);
  });

  it("GivenNoManifest_WhenPlaceholdersAreDropped_ThenItRefuses", () => {
    const root = mkdtempSync(join(tmpdir(), "placeholders-"));
    expect(() =>
      dropSandboxPlaceholders({ root, manifest: join(root, "missing"), emit: () => {} }),
    ).toThrow(/manifest/);
  });
});

describe("sandbox placeholders and prettier", () => {
  it("GivenTheSandboxPlaceholderNames_WhenPrettierIgnoreIsRead_ThenEachOneThisRepoLacksIsIgnored", () => {
    // In the build sandbox they are empty, unreadable binds; prettier --check . fails on them
    // (AI-56). The .claude settings files are real here and stay formatted.
    const real = new Set([".claude/settings.json", ".claude/settings.local.json"]);
    const ignored = readFileSync(join(import.meta.dirname, "..", ".prettierignore"), "utf8")
      .split("\n")
      .map((l) => l.trim());
    for (const name of SANDBOX_PLACEHOLDERS.filter((n) => !real.has(n))) {
      expect(ignored).toContain(`/${name}`);
    }
  });
});
