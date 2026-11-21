import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADR_DIR,
  ADR_FILE,
  loadAdrs,
  parseAdr,
  parseFrontmatter,
  renderIndex,
} from "./adr-index.mjs";

const adr = (fields, number = "0001") =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n\n# ${number} — body\n`;

/** A temp repo whose ADR folder holds `files`. */
const repo = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "adr-index-"));
  mkdirSync(join(dir, ADR_DIR), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, ADR_DIR, name), text);
  return dir;
};

describe("parseFrontmatter", () => {
  it("GivenPlainAndQuotedValues_WhenParsed_ThenUnquotesAndKeepsColons", () => {
    const text = '---\ntitle: "Local runner: Seatbelt"\nstatus: accepted (see: 0089)\n---\nbody';
    expect(parseFrontmatter(text)).toEqual({
      title: "Local runner: Seatbelt",
      status: "accepted (see: 0089)",
    });
  });

  it("GivenNoFrontmatter_WhenParsed_ThenNull", () => {
    expect(parseFrontmatter("# 0001 — x\n")).toBeNull();
  });
});

describe("parseAdr", () => {
  it("GivenTitleStatusAndAmends_WhenParsed_ThenReturnsThem", () => {
    const text = adr(
      { title: "Caps", status: "accepted", date: "2026-11-09", amends: "0063" },
      "0079",
    );
    expect(parseAdr("0079-dispatch-caps.md", text)).toEqual({
      number: "0079",
      file: "0079-dispatch-caps.md",
      title: "Caps",
      status: "accepted",
      amends: "0063",
      supersedes: undefined,
    });
  });

  it.each([
    ["bad file name", "79-caps.md", adr({ title: "t", status: "s" }), "file name"],
    ["no frontmatter", "0079-caps.md", "# 0079 — body\n", "frontmatter"],
    ["no title", "0079-caps.md", adr({ status: "s" }, "0079"), '"title"'],
    ["no status", "0079-caps.md", adr({ title: "t" }, "0079"), '"status"'],
    [
      "a heading for another number",
      "0079-caps.md",
      adr({ title: "t", status: "s" }, "0078"),
      "# 0079",
    ],
  ])("GivenAdrWith%s_WhenParsed_ThenThrows", (_, file, text, message) => {
    expect(() => parseAdr(file, text)).toThrow(message);
  });
});

describe("renderIndex", () => {
  it("GivenAdrs_WhenRendered_ThenOneLineEachWithSupersedesAndAmends", () => {
    const lines = renderIndex([
      { number: "0001", file: "0001-a.md", title: "A", status: "accepted" },
      {
        number: "0016",
        file: "0016-b.md",
        title: "B",
        status: "accepted",
        supersedes: "0004",
        amends: "0007",
      },
    ]).split("\n");
    expect(lines).toEqual([
      "- [0001](docs/architecture/adr/0001-a.md) A — accepted",
      "- [0016](docs/architecture/adr/0016-b.md) B — accepted; supersedes 0004; amends 0007",
    ]);
  });
});

describe("loadAdrs", () => {
  it("GivenAdrsAndReadme_WhenLoaded_ThenSortedAndReadmeSkipped", () => {
    const dir = repo({
      "0002-b.md": adr({ title: "B", status: "s" }, "0002"),
      "0001-a.md": adr({ title: "A", status: "s" }),
      "README.md": "# index\n",
    });
    const { adrs, errors } = loadAdrs(dir);
    expect(errors).toEqual([]);
    expect(adrs.map((a) => a.number)).toEqual(["0001", "0002"]);
  });

  // Two PRs that both take the next number (as PRs #182 and #201 did with 0102) fail here.
  it("GivenTwoAdrsWithOneNumber_WhenLoaded_ThenErrorNamesBoth", () => {
    const dir = repo({
      "0102-a.md": adr({ title: "A", status: "s" }, "0102"),
      "0102-b.md": adr({ title: "B", status: "s" }, "0102"),
      "0103-c.md": "# no frontmatter\n",
    });
    expect(loadAdrs(dir).errors).toEqual([
      "docs/architecture/adr/0103-c.md: needs frontmatter between --- lines",
      "0102-b.md and 0102-a.md share 0102",
    ]);
  });
});

describe("CLI", () => {
  const script = join(import.meta.dirname, "adr-index.mjs");
  const run = (dir) => spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

  it("GivenValidFolder_WhenRun_ThenPrintsIndex", () => {
    const result = run(repo({ "0001-a.md": adr({ title: "A", status: "accepted" }) }));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("- [0001](docs/architecture/adr/0001-a.md) A — accepted\n");
  });

  it("GivenAdrWithoutTitle_WhenRun_ThenExitsOne", () => {
    const result = run(repo({ "0001-a.md": adr({ status: "accepted" }) }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("0001-a.md");
  });
});

describe("this repo's ADRs", () => {
  const root = join(import.meta.dirname, "..");

  it("GivenEveryAdrFile_WhenLoaded_ThenEachHasTitleAndStatusAndAUniqueNumber", () => {
    const { adrs, errors } = loadAdrs(root);
    expect(errors).toEqual([]);
    const files = readdirSync(join(root, ADR_DIR)).filter((f) => ADR_FILE.test(f));
    expect(adrs.map((a) => a.file)).toEqual(files.sort());
  });
});
