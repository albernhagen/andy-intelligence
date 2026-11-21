import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check } from "./release-note-check.mjs";

const event = (body, extra = {}) => ({
  repository: { default_branch: "main" },
  pull_request: { body, base: { ref: "main" }, user: { login: "albernhagen" }, ...extra },
});
const GOOD = "What changed: A page.\nHow it works: A route.";

describe("check", () => {
  it("GivenAValidBlock_WhenChecked_ThenOk", () => {
    expect(check(event(GOOD))).toEqual({ ok: true, lines: ["Release note: OK."] });
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
