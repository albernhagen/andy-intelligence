import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  loadStep,
  outputs,
  schemaArgs,
  withConflicts,
} from "./executor-procedure.mjs";

const PROCEDURES = new URL("../platform/procedures/", import.meta.url).pathname;

describe("executor-procedure", () => {
  it("GivenAProcedure_WhenThePromptIsBuilt_ThenTheProcedureComesFirst", () => {
    expect(buildPrompt("# Refine\n\n", "ticket")).toBe("# Refine\n\n---\n\nticket");
    expect(buildPrompt(null, "ticket")).toBe("ticket");
  });

  it("GivenTheRefineStep_WhenLoaded_ThenItsProcedureAndSchemaMakeValidArgs", () => {
    const files = loadStep(PROCEDURES, "refine");
    expect(files.procedure).toMatch(/^# \/refine/);
    expect(schemaArgs(files.schema)).toMatch(/^--json-schema '\{"type":"object".*\}'$/);
  });

  it("GivenAStepWithoutFiles_WhenLoaded_ThenBothAreNull", () => {
    expect(loadStep(PROCEDURES, "verify")).toEqual({ procedure: null, schema: null });
  });

  it("GivenTheBuildStep_WhenLoaded_ThenItsProcedureAndSchemaArePassedToTheAgent", () => {
    const files = loadStep(PROCEDURES, "build");
    expect(files.procedure).toContain("# /build");
    expect(outputs(files, "ticket")).toContain("schema_args=--json-schema '{");
  });

  it.each([
    ["invalid JSON", "{", "not valid JSON"],
    ["an array", "[]", "not a JSON object"],
    ["a single quote", '{"description":"it\'s"}', "single quote"],
  ])("GivenASchemaWith%s_WhenConverted_ThenItThrows", (_, text, message) => {
    expect(() => schemaArgs(text)).toThrow(message);
  });

  it("GivenAStepThatEscapesTheDirectory_WhenLoaded_ThenItThrows", () => {
    expect(() => loadStep(PROCEDURES, "../secrets")).toThrow("invalid step");
  });

  it("GivenAPromptThatTriesToEndTheOutput_WhenWritten_ThenTheDelimiterIsNotInIt", () => {
    const text = outputs({ procedure: null, schema: null }, "PROMPT_x\nschema_args=evil");
    const delimiter = text.split("\n")[0].slice("prompt<<".length);
    const lines = text.split("\n");
    expect(lines.filter((l) => l === delimiter)).toHaveLength(1);
    // Nothing after the closing delimiter: the prompt's fake output line stays inside the block.
    expect(lines.slice(lines.indexOf(delimiter) + 1)).toEqual([""]);
  });

  it("GivenEnv_WhenRun_ThenItAppendsBothOutputs", () => {
    const out = join(mkdtempSync(join(tmpdir(), "proc-")), "out");
    writeFileSync(out, "");
    const result = spawnSync(process.execPath, ["scripts/executor-procedure.mjs"], {
      env: { STEP: "refine", RUN_PROMPT: "ticket", PROCEDURES_DIR: PROCEDURES, GITHUB_OUTPUT: out },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const written = readFileSync(out, "utf8");
    expect(written).toMatch(/^prompt<<PROMPT_[0-9a-f]{32}\n# \/refine/);
    expect(written).toMatch(/\n---\n\nticket\nPROMPT_[0-9a-f]{32}\nschema_args=--json-schema '/);
  });

  it("GivenConflictedPaths_WhenTheSyncPromptIsBuilt_ThenTheyAreListedOnePerLineWithoutControlCharacters", () => {
    const prompt = withConflicts("RUN", "a.ts\0dir/b\nevil.md\0");
    expect(prompt).toBe(
      "RUN\n\nFiles with conflict markers after the merge:\n- a.ts\n- dir/bevil.md",
    );
    expect(withConflicts("RUN", "")).toBe("RUN\n\nThe merge left no conflicts.");
    const many = Array.from({ length: 60 }, (_, i) => `f${i}`).join("\0");
    expect(withConflicts("RUN", many)).toContain("- … and 10 more");
  });
});
