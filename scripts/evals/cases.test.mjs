import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitTree, loadSuite, parseBaselines, validateCase } from "./cases.mjs";
import { MAX_CASES } from "./config.mjs";

const good = {
  id: "c1",
  agent: "adversarial-review",
  source: "test",
  inputs: { diff: "inputs/a.diff" },
  expect: [{ check: "finding", severity: ["blocker"], file: "a.ts" }],
  stubOutput: { summary: "x", findings: [] },
};

/** A throwaway repo committing `files` (path → text, or { link: target }); returns its path. */
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "evals-cases-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    if (typeof content === "object") symlinkSync(content.link, join(dir, path));
    else writeFileSync(join(dir, path), content);
  }
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "t");
  return dir;
}

describe("validateCase", () => {
  it("GivenAWellFormedCase_WhenValidated_ThenNoProblems", () => {
    expect(validateCase(good, "platform/evals/cases/c1.json")).toEqual([]);
  });

  it.each([
    ["unknown key", { ...good, assert: [{ type: "javascript" }] }, 'unknown key "assert"'],
    ["unknown agent", { ...good, agent: "build" }, "agent must be one of"],
    ["id not the file name", { ...good, id: "c2" }, "id must match file name"],
    [
      "input outside inputs/",
      { ...good, inputs: { diff: "../../.env" } },
      "inputs.diff must match",
    ],
    ["unknown check", { ...good, expect: [{ check: "javascript", value: "1" }] }, "check must be"],
    [
      "severity of another agent",
      { ...good, expect: [{ check: "no-finding", severity: ["high"] }] },
      "severity must be",
    ],
    [
      "dot workspace path",
      { ...good, files: { ".claude/settings.json": "inputs/a.diff" } },
      "without dot segments",
    ],
    [
      "parent workspace path",
      { ...good, files: { "a/../../x": "inputs/a.diff" } },
      "without dot segments",
    ],
    ["no checks", { ...good, expect: [] }, "expect must hold"],
    ["no stub output", { ...good, stubOutput: undefined }, "stubOutput must be"],
  ])("GivenA%s_WhenValidated_ThenRejected", (_name, raw, message) => {
    expect(validateCase(raw, "platform/evals/cases/c1.json").join("\n")).toContain(message);
  });
});

describe("parseBaselines", () => {
  it("GivenLiveAndStubMaps_WhenParsed_ThenReturnsThem", () => {
    expect(parseBaselines('{"$comment":"x","live":{"c1":10}}', "b.json")).toEqual({
      live: { c1: 10 },
      stub: {},
    });
  });

  it("GivenANonIntegerBaseline_WhenParsed_ThenThrows", () => {
    expect(() => parseBaselines('{"live":{"c1":"10"}}', "b.json")).toThrow("positive integer");
  });
});

describe("loadSuite", () => {
  const files = {
    "platform/evals/cases/c1.json": JSON.stringify(good),
    "platform/evals/cases/baselines.json": '{"live":{"c1":500}}',
    "platform/evals/inputs/a.diff": "diff --git a/a.ts b/a.ts\n",
  };

  it("GivenACommittedSuite_WhenLoaded_ThenCasesCarryTheirInputsAndBaselines", () => {
    const tree = gitTree(repo(files), "HEAD");
    const { cases, baselines } = loadSuite(tree, "platform/evals/cases");
    expect(cases.map((c) => [c.id, c.diff])).toEqual([["c1", "diff --git a/a.ts b/a.ts\n"]]);
    expect(baselines.live).toEqual({ c1: 500 });
  });

  it("GivenAnUnknownCaseId_WhenSelected_ThenThrows", () => {
    const tree = gitTree(repo(files), "HEAD");
    expect(() => loadSuite(tree, "platform/evals/cases", { only: ["nope"] })).toThrow(
      "case nope: not in",
    );
  });

  it("GivenASymlinkedInput_WhenLoaded_ThenRefused", () => {
    const tree = gitTree(
      repo({ ...files, "platform/evals/inputs/a.diff": { link: "/etc/hosts" } }),
      "HEAD",
    );
    expect(() => loadSuite(tree, "platform/evals/cases")).toThrow("symlinks are refused");
  });

  it("GivenMoreCasesThanTheCap_WhenLoaded_ThenRefusedBeforeReading", () => {
    const many = { ...files };
    for (let i = 0; i <= MAX_CASES; i += 1) {
      many[`platform/evals/cases/k${i}.json`] = JSON.stringify({ ...good, id: `k${i}` });
    }
    const tree = gitTree(repo(many), "HEAD");
    expect(() => loadSuite(tree, "platform/evals/cases")).toThrow(`the cap is ${MAX_CASES}`);
  });

  it("GivenInvalidJson_WhenLoaded_ThenTheErrorNamesTheFileNotItsContent", () => {
    const tree = gitTree(repo({ ...files, "platform/evals/cases/c1.json": "SECRET{" }), "HEAD");
    let message = "";
    try {
      loadSuite(tree, "platform/evals/cases");
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain("c1.json: not valid JSON");
    expect(message).not.toContain("SECRET");
  });

  it.each(["platform/evals/cases", "platform/evals/selftest"])(
    "GivenTheSuiteInThisRepo_WhenValidated_ThenEveryCaseIsValidWithInputs: %s",
    (dir) => {
      const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "baselines.json");
      expect(files.length).toBeGreaterThan(0);
      expect(files.length).toBeLessThanOrEqual(MAX_CASES);
      for (const f of files) {
        const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
        expect(validateCase(raw, `${dir}/${f}`)).toEqual([]);
        for (const input of [raw.inputs.diff, ...Object.values(raw.files ?? {})]) {
          expect(existsSync(join("platform/evals", input))).toBe(true);
        }
      }
      parseBaselines(readFileSync(join(dir, "baselines.json"), "utf8"), dir);
    },
  );
});
