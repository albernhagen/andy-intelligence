import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENTS } from "./config.mjs";
import { assertSupportedSchema, schemaProblems } from "./schema-check.mjs";

const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["blocker", "should-fix"] },
          line: { type: "integer" },
        },
        required: ["severity"],
      },
    },
  },
  required: ["summary", "findings"],
};

describe("schemaProblems", () => {
  it("GivenAMatchingValue_WhenChecked_ThenNoProblems", () => {
    expect(
      schemaProblems({ summary: "s", findings: [{ severity: "blocker", line: 3 }] }, schema),
    ).toEqual([]);
  });

  it.each([
    [{ findings: [] }, "$.summary: missing"],
    [{ summary: "s", findings: "x" }, "$.findings: not array"],
    [
      { summary: "s", findings: [{ severity: "nit" }] },
      "$.findings[0].severity: not an allowed value",
    ],
    [
      { summary: "s", findings: [{ severity: "blocker", line: 1.5 }] },
      "$.findings[0].line: not integer",
    ],
    [null, "$: not object"],
  ])("GivenAWrongValue_WhenChecked_ThenAPathNotTheValue %#", (value, problem) => {
    expect(schemaProblems(value, schema)).toContain(problem);
  });
});

describe("assertSupportedSchema", () => {
  it("GivenAnUnsupportedKeyword_WhenChecked_ThenThrows", () => {
    expect(() => assertSupportedSchema({ type: "object", oneOf: [] })).toThrow(
      'unsupported schema keyword "oneOf"',
    );
  });

  it.each(Object.keys(AGENTS))("GivenTheAgentSchema %s_WhenChecked_ThenSupported", (agent) => {
    expect(() =>
      assertSupportedSchema(JSON.parse(readFileSync(AGENTS[agent].schema, "utf8"))),
    ).not.toThrow();
  });
});
