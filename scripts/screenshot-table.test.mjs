import { describe, expect, it } from "vitest";
import {
  END,
  START,
  buildTable,
  filesOfNameStatus,
  isStoredImage,
  parseTable,
  repoOfRemote,
  replaceSection,
} from "./screenshot-table.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const DIR = "apps/web/e2e/__screenshots__";
const table = (files) => buildTable({ owner: "o", repo: "r", baseSha: BASE, headSha: HEAD, files });

describe("buildTable", () => {
  it("GivenAChangedImage_WhenBuilt_ThenARowWithBaseAndHeadRawUrlsPinnedToShas", () => {
    const out = table([{ path: `${DIR}/board.png`, status: "modified" }]);
    expect(out).toContain(START);
    expect(out).toContain(END);
    expect(out).toContain(
      `| \`${DIR}/board.png\` | ![before](https://raw.githubusercontent.com/o/r/${BASE}/${DIR}/board.png) | ![after](https://raw.githubusercontent.com/o/r/${HEAD}/${DIR}/board.png) |`,
    );
  });

  it("GivenAnAddedImage_WhenBuilt_ThenBeforeSaysNew", () => {
    const out = table([{ path: `${DIR}/new.png`, status: "added" }]);
    expect(out).toContain(`| \`${DIR}/new.png\` | new | ![after](`);
  });

  it("GivenARemovedImage_WhenBuilt_ThenAfterSaysRemoved", () => {
    const out = table([{ path: `${DIR}/old.png`, status: "removed" }]);
    expect(out).toMatch(/\| !\[before\]\([^)]+old\.png\) \| removed \|$/m);
  });

  it("GivenNoStoredImageChanged_WhenBuilt_ThenNull", () => {
    expect(table([{ path: "apps/web/src/App.tsx", status: "modified" }])).toBeNull();
    expect(table([])).toBeNull();
  });

  it("GivenABranchNameInsteadOfASha_WhenBuilt_ThenThrows", () => {
    expect(() =>
      buildTable({ owner: "o", repo: "r", baseSha: "main", headSha: HEAD, files: [] }),
    ).toThrow(/full SHAs/);
  });

  it("GivenAnUnsafePath_WhenBuilt_ThenItIsLeftOut", () => {
    expect(table([{ path: `${DIR}/../x.png`, status: "added" }])).toBeNull();
    expect(table([{ path: `${DIR}/a b|c.png`, status: "added" }])).toBeNull();
  });
});

describe("parseTable", () => {
  it("GivenABuiltTable_WhenParsed_ThenEveryRowComesBack", () => {
    const body = `What changed: x\n\n${table([
      { path: `${DIR}/a.png`, status: "modified" },
      { path: `${DIR}/b.png`, status: "added" },
      { path: `${DIR}/c.png`, status: "removed" },
    ])}`;
    const parsed = parseTable(body);
    expect(parsed.invalid).toEqual([]);
    expect(parsed.rows.map((r) => [r.path, r.before.present, r.after.present])).toEqual([
      [`${DIR}/a.png`, true, true],
      [`${DIR}/b.png`, false, true],
      [`${DIR}/c.png`, true, false],
    ]);
    expect(parsed.rows[0].after).toMatchObject({ owner: "o", repo: "r", sha: HEAD });
  });

  it("GivenNoMarkers_WhenParsed_ThenNull", () => {
    expect(parseTable("## Before and after\n| `x.png` | new | new |")).toBeNull();
  });

  it("GivenRowsOfTheWrongShape_WhenParsed_ThenReportedAsInvalidAndNotUsed", () => {
    const body = [
      START,
      `| \`${DIR}/a.png\` | new | ![after](https://evil.example/${HEAD}/${DIR}/a.png) |`,
      `| \`${DIR}/b.png\` | new | ![after](https://raw.githubusercontent.com/o/r/main/${DIR}/b.png) |`,
      `| \`${DIR}/c.png\` | new | ![after](https://raw.githubusercontent.com/o/r/${HEAD}/${DIR}/other.png) |`,
      `| \`$(rm -rf /).png\` | new | removed |`,
      END,
    ].join("\n");
    const parsed = parseTable(body);
    expect(parsed.rows).toEqual([]);
    expect(parsed.invalid).toHaveLength(4);
  });
});

describe("replaceSection", () => {
  const t1 = `${START}\nold\n${END}`;
  it("GivenNoTable_WhenReplaced_ThenAppended", () => {
    expect(replaceSection("Body", t1)).toBe(`Body\n\n${t1}`);
  });
  it("GivenATable_WhenReplaced_ThenOnlyItChanges", () => {
    expect(replaceSection(`Top\n\n${t1}\n\nBottom`, `${START}\nnew\n${END}`)).toBe(
      `Top\n\n${START}\nnew\n${END}\n\nBottom`,
    );
  });
  it("GivenATableAndNoChangedImage_WhenReplaced_ThenTheTableIsRemoved", () => {
    expect(replaceSection(`Top\n\n${t1}`, null)).toBe("Top");
  });
});

describe("helpers", () => {
  it("GivenPaths_WhenChecked_ThenOnlyPngsUnderScreenshotsAreStoredImages", () => {
    expect(isStoredImage(`${DIR}/a.png`)).toBe(true);
    expect(isStoredImage("apps/web/public/logo.png")).toBe(false);
    expect(isStoredImage(`${DIR}/a.txt`)).toBe(false);
  });
  it("GivenRemotes_WhenParsed_ThenOwnerAndRepo", () => {
    expect(repoOfRemote("https://github.com/o/r.git")).toEqual({ owner: "o", repo: "r" });
    expect(repoOfRemote("git@github.com:o/r.git")).toEqual({ owner: "o", repo: "r" });
    expect(() => repoOfRemote("https://gitlab.com/o/r")).toThrow();
  });
  it("GivenNameStatus_WhenParsed_ThenARenameIsARemovalAndAnAddition", () => {
    expect(filesOfNameStatus("M\ta.png\nA\tb.png\nD\tc.png\nR100\td.png\te.png\n")).toEqual([
      { path: "a.png", status: "modified" },
      { path: "b.png", status: "added" },
      { path: "c.png", status: "removed" },
      { path: "d.png", status: "removed" },
      { path: "e.png", status: "added" },
    ]);
  });
});
