import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES_DIR, loadFeatures, parseFeature, renderIndex } from "./features.mjs";

const feature = (name, what, how) => `# ${name}\n\n${what}\n\n**How to use:** ${how}\n`;

/** A temp repo whose docs/features/ holds `files`. */
const repo = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "features-"));
  mkdirSync(join(dir, FEATURES_DIR), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, FEATURES_DIR, name), text);
  }
  return dir;
};

describe("parseFeature", () => {
  it("GivenWellFormedFile_WhenParsed_ThenReturnsNameWhatAndHow", () => {
    expect(parseFeature(feature("Sign-in", "Google sign-in", "`/login`"))).toEqual({
      name: "Sign-in",
      what: "Google sign-in",
      how: "`/login`",
    });
  });

  it("GivenMultiLineSections_WhenParsed_ThenKeepsEveryLine", () => {
    const text = "# A\n\nline one\nline two\n\n**How to use:** first\nsecond\n";
    expect(parseFeature(text)).toEqual({
      name: "A",
      what: "line one\nline two",
      how: "first\nsecond",
    });
  });

  it.each([
    ["no title", "Sign-in\n\nwhat\n\n**How to use:** how\n", "first line"],
    ["no how line", "# A\n\nwhat\n", "How to use"],
    ["empty what", "# A\n\n**How to use:** how\n", "what-it-does"],
    ["empty how", "# A\n\nwhat\n\n**How to use:**\n", "empty"],
  ])("GivenFileWith%s_WhenParsed_ThenThrows", (_, text, message) => {
    expect(() => parseFeature(text)).toThrow(message);
  });
});

describe("renderIndex", () => {
  it("GivenFeatures_WhenRendered_ThenOneRowEachWithPipesEscaped", () => {
    const table = renderIndex([{ name: "A", what: "x | y\nz", how: "h", file: "a.md" }]);
    expect(table.split("\n")).toEqual([
      "| Feature | What it does | How to use |",
      "| --- | --- | --- |",
      "| [A](docs/features/a.md) | x \\| y z | h |",
    ]);
  });

  it("GivenBackslashBeforePipe_WhenRendered_ThenBothEscaped", () => {
    const [, , row] = renderIndex([{ name: "A", what: "a \\| b", how: "h", file: "a.md" }]).split(
      "\n",
    );
    expect(row).toBe("| [A](docs/features/a.md) | a \\\\\\| b | h |");
  });
});

describe("loadFeatures", () => {
  it("GivenFilesAndReadme_WhenLoaded_ThenSortedByFileAndReadmeSkipped", () => {
    const dir = repo({
      "b.md": feature("B", "b", "b"),
      "a.md": feature("A", "a", "a"),
      "README.md": "# Features\n",
    });
    const { features, errors } = loadFeatures(dir);
    expect(errors).toEqual([]);
    expect(features.map((f) => f.file)).toEqual(["a.md", "b.md"]);
  });

  it("GivenMalformedAndDuplicateFiles_WhenLoaded_ThenErrorsNameThem", () => {
    const dir = repo({
      "a.md": feature("A", "a", "a"),
      "b.md": feature("A", "b", "b"),
      "c.md": "no title\n",
    });
    const { errors } = loadFeatures(dir);
    expect(errors).toEqual([
      'docs/features/c.md: first line must be "# <Feature name>"',
      'b.md and a.md share "A"',
    ]);
  });
});

describe("CLI", () => {
  const script = join(import.meta.dirname, "features.mjs");
  const run = (dir) => spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

  it("GivenValidFolder_WhenRun_ThenPrintsTable", () => {
    const result = run(repo({ "a.md": feature("A", "a", "a") }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| [A](docs/features/a.md) | a | a |");
  });

  it("GivenMalformedFile_WhenRun_ThenExitsOne", () => {
    const result = run(repo({ "a.md": "nope\n" }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/features/a.md");
  });
});

describe("this repo's features", () => {
  const root = join(import.meta.dirname, "..");

  it("GivenEveryFeatureFile_WhenLoaded_ThenEachIsWellFormedAndUnique", () => {
    const { features, errors } = loadFeatures(root);
    expect(errors).toEqual([]);
    expect(features.length).toBeGreaterThan(0);
  });

  it("GivenEveryFeatureFile_WhenRelativeLinksRead_ThenEachTargetExists", () => {
    const { features } = loadFeatures(root);
    const broken = features.flatMap((f) => {
      const text = readFileSync(join(root, FEATURES_DIR, f.file), "utf8");
      return [...text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)]
        .map((m) => m[1])
        .filter((target) => !/^[a-z]+:/.test(target))
        .filter((target) => !existsSync(join(root, FEATURES_DIR, target)))
        .map((target) => `${f.file} → ${target}`);
    });
    expect(broken).toEqual([]);
  });

  it("GivenFeaturesFolder_WhenListed_ThenNoLegacyTableRemains", () => {
    expect(existsSync(join(root, dirname(FEATURES_DIR), "features.md"))).toBe(false);
  });
});
