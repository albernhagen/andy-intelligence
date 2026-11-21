import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configFor, loadConfig, parseArgs, parseGhResponse } from "./baseline.mjs";
import { pinActions } from "./files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, "platform/baseline/manifest.json"), "utf8"),
);
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

describe("parseArgs", () => {
  it("GivenOnboardWithRef_WhenParsed_ThenOptions", () => {
    expect(parseArgs(["onboard", "albernhagen/scratch", "--ref", "v1.0.0"])).toMatchObject({
      command: "onboard",
      repo: "albernhagen/scratch",
      ref: "v1.0.0",
    });
  });

  it("GivenFilesWithoutRef_WhenParsed_ThenError", () => {
    expect(() => parseArgs(["files", "albernhagen/scratch"])).toThrow("needs --ref");
  });

  it("GivenABadRepoOrSection_WhenParsed_ThenError", () => {
    expect(() => parseArgs(["check", "scratch"])).toThrow("owner/name");
    expect(() => parseArgs(["check", "a/b", "--only", "ruleset,secrets"])).toThrow("secrets");
  });
});

describe("parseGhResponse", () => {
  it("GivenHeadersAndJson_WhenParsed_ThenStatusAndData", () => {
    const out = 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"enabled":true}';
    expect(parseGhResponse(out)).toEqual({ status: 200, data: { enabled: true } });
  });

  it("GivenNoContent_WhenParsed_ThenNullData", () => {
    expect(parseGhResponse("HTTP/2.0 204 No Content\r\nX: y\r\n\r\n")).toEqual({
      status: 204,
      data: null,
    });
  });

  it("GivenNoStatusLine_WhenParsed_ThenError", () => {
    expect(() => parseGhResponse("", "gh: not logged in")).toThrow("not logged in");
  });
});

describe("baseline consistency", () => {
  it("GivenTheManifest_WhenRead_ThenEverySourceFileExists", () => {
    const entries = [...manifest.managed, ...manifest.lines, ...manifest.seed, ...manifest.starter];
    for (const e of entries) expect(existsSync(path.join(ROOT, e.from)), e.from).toBe(true);
  });

  it("GivenPinnedWorkflows_WhenRendered_ThenNoLocalActionsRemain", () => {
    for (const e of manifest.managed.filter((m) => m.pin)) {
      const out = pinActions(read(e.from), {
        source: manifest.source,
        sha: "a".repeat(40),
        ref: "v1.0.0",
      });
      expect(out, e.from).not.toMatch(/uses:\s+\.\//);
    }
  });

  it("GivenTheRulesetForAManagedRepo_WhenComparedWithCallerJobs_ThenEveryRequiredCheckIsAJob", () => {
    const workflows = manifest.managed
      .filter((m) => m.pin)
      .map((m) => read(m.from))
      .join("\n");
    const jobs = new Set([...workflows.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]));
    for (const lang of workflows.match(/language: \[([^\]]+)\]/)[1].split(","))
      jobs.add(`codeql (${lang.trim()})`);
    const required = requiredChecks(
      configFor(loadConfig(), "albernhagen/managed", manifest.source),
    );
    for (const check of required) expect(jobs.has(check), check).toBe(true);
  });

  it("GivenSourceOnlyChecks_WhenComparedWithThisRepo_ThenEachIsRequiredAndAJobHere", () => {
    const config = loadConfig();
    const workflows = readdirSync(path.join(ROOT, ".github/workflows"))
      .map((f) => read(`.github/workflows/${f}`))
      .join("\n");
    const jobs = new Set([...workflows.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]));
    expect(config.sourceOnlyChecks.length).toBeGreaterThan(0);
    for (const check of config.sourceOnlyChecks) {
      expect(requiredChecks(config), check).toContain(check);
      expect(jobs.has(check), check).toBe(true);
    }
  });
});

const requiredChecks = (config) =>
  config.ruleset.rules
    .find((r) => r.type === "required_status_checks")
    .parameters.required_status_checks.map((c) => c.context);

describe("configFor", () => {
  it("GivenTheSourceRepo_WhenConfigured_ThenSourceOnlyChecksStayRequired", () => {
    const config = configFor(loadConfig(), "Albernhagen/Andy-Intelligence", manifest.source);
    expect(requiredChecks(config)).toContain("firestore-suite");
  });

  it("GivenAManagedRepo_WhenConfigured_ThenSourceOnlyChecksAreDroppedAndTheRestKept", () => {
    const base = loadConfig();
    const config = configFor(base, "albernhagen/managed", manifest.source);
    expect(requiredChecks(config)).not.toContain("firestore-suite");
    expect(requiredChecks(config)).toEqual(
      requiredChecks(base).filter((c) => !base.sourceOnlyChecks.includes(c)),
    );
    expect(requiredChecks(base)).toContain("firestore-suite");
  });
});

/**
 * AI-106: M5.3: the managed-repo caller (ADR-0096). The control plane accepts callbacks and the
 * push grant only from `CLAUDE_EXECUTOR_REF`, so the caller must call exactly that executor.
 */
describe("managed-repo caller", () => {
  const CALLER = "template/.github/workflows/agent-run.yml";
  const executorTs = read("packages/github/src/executor.ts");
  const platformRepo = /PLATFORM_REPO = "([^"]+)"/.exec(executorTs)?.[1];
  const executorRef = `${platformRepo}/.github/workflows/claude-executor.yml@refs/heads/main`;
  const uses = (text) => [...text.matchAll(/^\s+uses:\s+(\S+)/gm)].map((m) => m[1]);
  const withoutComments = (text) =>
    text
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");

  it("GivenTheManifest_WhenRead_ThenTheCallerIsAManagedFile", () => {
    expect(manifest.managed).toContainEqual({
      path: ".github/workflows/agent-run.yml",
      from: CALLER,
    });
  });

  it("GivenTheCaller_WhenRead_ThenItCallsTheExecutorTheControlPlaneAccepts", () => {
    expect(executorTs).toContain(
      "export const CLAUDE_EXECUTOR_REF = `${PLATFORM_REPO}/.github/workflows/claude-executor.yml@refs/heads/main`",
    );
    const [only, ...rest] = uses(read(CALLER));
    expect(rest).toEqual([]);
    expect(only.replace(/@main$/, "@refs/heads/main")).toBe(executorRef);
  });

  it("GivenTheCaller_WhenRead_ThenOnlyTheAdrsPermissionsAndInputs", () => {
    const text = read(CALLER);
    expect(text).toMatch(/^permissions: \{\}$/m);
    const jobPermissions = /^ {4}permissions:\n((?: {6}.+\n)+)/m.exec(text)?.[1] ?? "";
    expect(
      jobPermissions
        .split("\n")
        .filter(Boolean)
        .map((l) => l.trim().split(" #")[0]),
    ).toEqual(["contents: read", "id-token: write"]);
    const inputs = /^ {4}inputs:\n((?: {6}.+\n)+)/m.exec(text)?.[1] ?? "";
    expect([...inputs.matchAll(/^ {6}([\w-]+):$/gm)].map((m) => m[1])).toEqual([
      "run_id",
      "credential",
    ]);
  });

  it("GivenTheCaller_WhenRead_ThenItPassesBothCredentialsByNameForTheAgentEnvironment", () => {
    // AI-106: GitHub resolves a passed secret from the executor job's environment (`agent`)
    // first; the caller must still name it, or it reaches the executor empty.
    const text = read(CALLER);
    expect(text).toContain("CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}");
    expect(text).toContain("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}");
  });

  it("GivenThisReposCaller_WhenComparedWithTheTemplate_ThenOnlyUsesDiffers", () => {
    const local = withoutComments(read(".github/workflows/agent-run.yml"));
    const template = withoutComments(read(CALLER));
    expect(template.replace(uses(template)[0], "./.github/workflows/claude-executor.yml")).toBe(
      local,
    );
  });
});
