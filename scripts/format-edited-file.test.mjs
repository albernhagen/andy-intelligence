import { describe, expect, it } from "vitest";
import { commandsFor, editedFile } from "./format-edited-file.mjs";

const root = "/repo";

describe("editedFile", () => {
  it("GivenAbsolutePathInProject_WhenResolved_ThenReturnsPath", () => {
    const payload = { tool_input: { file_path: "/repo/apps/api/src/main.ts" } };
    expect(editedFile(payload, root)).toBe("/repo/apps/api/src/main.ts");
  });

  it("GivenRelativePath_WhenResolved_ThenReturnsAbsolutePath", () => {
    expect(editedFile({ tool_input: { file_path: "README.md" } }, root)).toBe("/repo/README.md");
  });

  it("GivenPathOutsideProject_WhenResolved_ThenReturnsNull", () => {
    expect(editedFile({ tool_input: { file_path: "/etc/hosts" } }, root)).toBeNull();
    expect(editedFile({ tool_input: { file_path: "../other/x.ts" } }, root)).toBeNull();
  });

  it("GivenPathInNodeModules_WhenResolved_ThenReturnsNull", () => {
    const payload = { tool_input: { file_path: "/repo/node_modules/x/index.js" } };
    expect(editedFile(payload, root)).toBeNull();
  });

  it("GivenPayloadWithoutFilePath_WhenResolved_ThenReturnsNull", () => {
    expect(editedFile({ tool_input: {} }, root)).toBeNull();
    expect(editedFile({}, root)).toBeNull();
    expect(editedFile(null, root)).toBeNull();
  });
});

describe("commandsFor", () => {
  it("GivenTypeScriptFile_WhenPlanned_ThenRunsPrettierThenEslint", () => {
    expect(commandsFor("/repo/a.ts")).toEqual([
      ["prettier", ["--write", "--ignore-unknown", "/repo/a.ts"]],
      ["eslint", ["--fix", "--no-warn-ignored", "/repo/a.ts"]],
    ]);
  });

  it("GivenMarkdownFile_WhenPlanned_ThenRunsPrettierOnly", () => {
    expect(commandsFor("/repo/README.md")).toEqual([
      ["prettier", ["--write", "--ignore-unknown", "/repo/README.md"]],
    ]);
  });
});
