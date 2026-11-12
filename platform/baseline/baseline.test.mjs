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

// AI-106 (ADR-0096): the managed repos' caller of the platform executor.
describe("managed-repo caller (agent-run.yml)", () => {
  const CALLER = "template/.github/workflows/agent-run.yml";
  const caller = read(CALLER);
  const lines = caller.split("\n");
  /** Lines of a block: those indented deeper than the line that starts it. */
  const block = (start) => {
    const at = lines.findIndex((l) => l.trimEnd() === start.trimEnd());
    expect(at, start).toBeGreaterThan(-1);
    const indent = start.length - start.trimStart().length;
    const out = [];
    for (const l of lines.slice(at + 1)) {
      if (l.trim() === "") continue;
      if (l.length - l.trimStart().length <= indent) break;
      out.push(l);
    }
    return out;
  };
  const keys = (blockLines) => {
    const depth = Math.min(...blockLines.map((l) => l.length - l.trimStart().length));
    return blockLines
      .filter((l) => l.length - l.trimStart().length === depth)
      .map((l) => l.trim().replace(/:.*$/, ""));
  };

  it("GivenTheManifest_WhenRead_ThenTheCallerIsAManagedFileFromTheTemplate", () => {
    expect(manifest.managed).toContainEqual({
      path: ".github/workflows/agent-run.yml",
      from: CALLER,
    });
  });

  it("GivenTheCaller_WhenRead_ThenItCallsTheExecutorTheControlPlaneChecks", () => {
    // The ref the callbacks and push grant accept (packages/github/src/executor.ts), minus
    // `refs/heads/`: a change on either side fails here.
    const ts = read("packages/github/src/executor.ts");
    const platform = ts.match(/export const PLATFORM_REPO = "([^"]+)";/)[1];
    const suffix = ts.match(/export const CLAUDE_EXECUTOR_REF = `\$\{PLATFORM_REPO\}([^`]+)`;/)[1];
    const expected = `${platform}${suffix}`.replace("@refs/heads/", "@");
    expect(expected).toBe(
      "albernhagen/andy-intelligence/.github/workflows/claude-executor.yml@main",
    );
    const uses = lines.filter((l) => /^\s*uses:/.test(l)).map((l) => l.trim());
    expect(uses).toEqual([`uses: ${expected}`]);
  });

  it("GivenTheCaller_WhenRead_ThenItTakesOnlyTheRunIdAndCredentialKind", () => {
    expect(keys(block("on:"))).toEqual(["workflow_dispatch"]);
    expect(keys(block("    inputs:"))).toEqual(["run_id", "credential"]);
  });

  it("GivenTheCaller_WhenRead_ThenItRequestsOnlyTheAdrsPermissions", () => {
    expect(lines).toContain("permissions: {}");
    expect(keys(block("jobs:"))).toEqual(["agent-run"]);
    const job = block("    permissions:").map((l) => l.replace(/#.*$/, "").trim());
    expect(job).toEqual(["contents: read", "id-token: write"]);
    expect(lines.filter((l) => /^\s*permissions:/.test(l))).toHaveLength(2);
  });

  it("GivenThisReposOwnCaller_WhenComparedWithTheTemplate_ThenOnlyUsesDiffers", () => {
    const code = (text) =>
      text
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .filter((l) => !/^\s*uses:/.test(l));
    expect(code(caller)).toEqual(code(read(".github/workflows/agent-run.yml")));
  });
});
