import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RISKS_DIR,
  compareIds,
  duplicateIds,
  loadRisks,
  parseRisk,
  renderRegister,
} from "./risks.mjs";

const risk = (id, { severity = "low", status = "open", owner = "Andy" } = {}, body) =>
  `---\nid: ${id}\nseverity: ${severity}\nstatus: ${status}\nowner: ${owner}\n---\n\n# ${id}\n\n` +
  (body ?? `**Risk:** risk ${id}\n\n**Mitigation / next step:** fix ${id}\n`);

/** A temp repo whose docs/security/risks/ holds `files`. */
const repo = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "risks-"));
  mkdirSync(join(dir, RISKS_DIR), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, RISKS_DIR, name), text);
  }
  return dir;
};

describe("parseRisk", () => {
  it("GivenWellFormedFile_WhenParsed_ThenReturnsFieldsAndText", () => {
    expect(parseRisk("R1.md", risk("R1", { severity: "high", status: "mitigated" }))).toEqual({
      id: "R1",
      severity: "high",
      status: "mitigated",
      owner: "Andy",
      risk: "risk R1",
      mitigation: "fix R1",
    });
  });

  it("GivenTicketIds_WhenParsed_ThenAccepted", () => {
    expect(parseRisk("R-AI-6.md", risk("R-AI-6")).id).toBe("R-AI-6");
    expect(parseRisk("R-AI-6-2.md", risk("R-AI-6-2")).id).toBe("R-AI-6-2");
  });

  it("GivenMultiLineParagraphs_WhenParsed_ThenKeepsEveryLine", () => {
    const body = "**Risk:** a\nb\n\n**Mitigation / next step:** c\n\nd\n";
    const parsed = parseRisk("R1.md", risk("R1", {}, body));
    expect(parsed.risk).toBe("a\nb");
    expect(parsed.mitigation).toBe("c\n\nd");
  });

  it.each([
    ["bad file name", "r1.md", risk("r1"), "file name"],
    ["no frontmatter", "R1.md", "# R1\n", "frontmatter"],
    ["id unlike file name", "R1.md", risk("R2"), "match the file name"],
    ["unknown severity", "R1.md", risk("R1", { severity: "huge" }), "severity"],
    ["unknown status", "R1.md", risk("R1", { status: "done" }), "status"],
    ["no owner", "R1.md", risk("R1", { owner: "" }), "owner"],
    ["no mitigation", "R1.md", risk("R1", {}, "**Risk:** a\n"), "Mitigation"],
    [
      "empty risk",
      "R1.md",
      risk("R1", {}, "**Risk:**\n\n**Mitigation / next step:** b\n"),
      "empty",
    ],
  ])("GivenFileWith%s_WhenParsed_ThenThrows", (_, file, text, message) => {
    expect(() => parseRisk(file, text)).toThrow(message);
  });
});

describe("compareIds", () => {
  it("GivenMixedIds_WhenSorted_ThenNumericThenTicketKeysInOrder", () => {
    const ids = ["R-AI-72", "R10", "R-AI-6-2", "R2", "R-AI-6", "R-B-1"];
    expect(ids.sort(compareIds)).toEqual(["R2", "R10", "R-AI-6", "R-AI-6-2", "R-AI-72", "R-B-1"]);
  });
});

describe("renderRegister", () => {
  const r = (id, status, text = "t") => ({
    id,
    severity: "low",
    status,
    owner: "Andy",
    risk: text,
    mitigation: "m",
  });

  it("GivenOpenAndClosedRisks_WhenRendered_ThenClosedOnlyInClosedSection", () => {
    const out = renderRegister([r("R2", "closed"), r("R10", "mitigated"), r("R1", "open")]);
    const [open, closed] = out.split("## Closed risks");
    expect(open).toContain("| [R1](docs/security/risks/R1.md) | low | open | Andy | t | m |");
    expect(open.indexOf("[R1]")).toBeLessThan(open.indexOf("[R10]"));
    expect(open).not.toContain("[R2]");
    expect(closed).toContain("[R2]");
  });

  it("GivenNoClosedRisks_WhenRendered_ThenNoClosedSection", () => {
    expect(renderRegister([r("R1", "open")])).not.toContain("Closed");
  });

  it("GivenPipesAndNewlines_WhenRendered_ThenOneRowWithPipesEscaped", () => {
    const out = renderRegister([r("R1", "open", "a | b\nc \\| d")]);
    expect(out).toContain("| a \\| b c \\\\\\| d |");
  });
});

describe("loadRisks", () => {
  it("GivenFilesAndReadme_WhenLoaded_ThenReadmeSkipped", () => {
    const { risks, errors } = loadRisks(
      repo({ "R1.md": risk("R1"), "R-AI-6.md": risk("R-AI-6"), "README.md": "# Risks\n" }),
    );
    expect(errors).toEqual([]);
    expect(risks.map((x) => x.id).sort()).toEqual(["R-AI-6", "R1"]);
  });

  it("GivenMalformedFile_WhenLoaded_ThenErrorNamesIt", () => {
    const { errors } = loadRisks(repo({ "R1.md": risk("R1"), "R2.md": "nope\n" }));
    expect(errors).toEqual(["docs/security/risks/R2.md: needs frontmatter between --- lines"]);
  });
});

describe("duplicateIds", () => {
  it("GivenTwoRisksWithOneIdInAnyCase_WhenChecked_ThenNamesBoth", () => {
    const list = [
      { id: "R1", file: "a.md" },
      { id: "r1", file: "b.md" },
      { id: "R2", file: "c.md" },
    ];
    expect(duplicateIds(list)).toEqual(["b.md and a.md share id r1"]);
  });
});

describe("CLI", () => {
  const script = join(import.meta.dirname, "risks.mjs");
  const run = (dir) => spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

  it("GivenValidFolder_WhenRun_ThenPrintsRegister", () => {
    const result = run(repo({ "R1.md": risk("R1") }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| [R1](docs/security/risks/R1.md) | low | open | Andy |");
  });

  it("GivenMalformedFile_WhenRun_ThenExitsOneNamingIt", () => {
    const result = run(repo({ "R1.md": "nope\n" }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/security/risks/R1.md");
  });
});

describe("this repo's risks", () => {
  const root = join(import.meta.dirname, "..");

  it("GivenEveryRiskFile_WhenLoaded_ThenEachIsWellFormedAndUnique", () => {
    const { risks, errors } = loadRisks(root);
    expect(errors).toEqual([]);
    expect(risks.length).toBeGreaterThan(0);
  });

  it("GivenEveryRiskFile_WhenRelativeLinksRead_ThenEachTargetExists", () => {
    const { risks } = loadRisks(root);
    const broken = risks.flatMap((r) => {
      const text = readFileSync(join(root, RISKS_DIR, r.file), "utf8");
      return [...text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)]
        .map((m) => m[1])
        .filter((target) => !/^[a-z]+:/.test(target))
        .filter((target) => !existsSync(join(root, RISKS_DIR, target)))
        .map((target) => `${r.file} → ${target}`);
    });
    expect(broken).toEqual([]);
  });

  it("GivenSecurityFolder_WhenRead_ThenNoHandEditedRiskTableRemains", () => {
    const security = join(root, "docs", "security");
    expect(existsSync(join(security, "closed-risks.md"))).toBe(false);
    const main = readFileSync(join(security, "threat-model.md"), "utf8");
    expect(main).not.toMatch(/^\| R(\d|-)/m);
  });
});
