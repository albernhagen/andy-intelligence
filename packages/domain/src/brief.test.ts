import { readFileSync } from "node:fs";
import { BRIEF_MAX_WORDS, BRIEF_SECTIONS, BriefAnswers } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { countWords, plainAnswer, renderBrief } from "./brief";

const full: BriefAnswers = {
  projectName: "Trail log",
  idea: "A log of trail runs with elevation and weather.",
  problem: "Today runs live in a watch app that hides the weather.",
  users: "Andy only.",
  business: "No revenue intent.",
  vision: "Every run logged without typing.",
  goals: ["Zero typing", "Weekly summary"],
  nonGoals: ["Social features"],
  stack: "TypeScript, React.",
  cloud: "GCP, scale to zero.",
  environments: "Dev and prod.",
  constraints: "Public repo.",
  qualityBar: "Tests and CI green.",
  openQuestions: ["Which weather API?"],
};

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

const rendered = (answers: BriefAnswers) => {
  const result = renderBrief(answers);
  if (!result.ok) throw new Error(`rejected: ${result.section}`);
  return result.markdown;
};

describe("renderBrief", () => {
  it("GivenAFullAnswerSet_WhenRendered_ThenTheSixSectionsAppearInOrder", () => {
    const md = rendered(full);
    const headings = md.split("\n").filter((l) => l.startsWith("## "));
    expect(headings).toEqual([
      "## Idea",
      "## Users and business",
      "## Vision",
      "## Goals and non-goals",
      "## Architectural expectations",
      "## Open questions",
    ]);
    expect(md.startsWith("# Project brief — Trail log\n")).toBe(true);
  });

  it("GivenAFullAnswerSet_WhenRendered_ThenEveryAnswerIsInTheBrief", () => {
    const md = rendered(full);
    expect(md).toContain("1. Zero typing\n2. Weekly summary");
    expect(md).toContain("- Social features");
    expect(md).toContain("- **Quality bar:** Tests and CI green.");
    expect(md).toContain("- Which weather API?");
  });

  it("GivenNoNonGoalsOrOpenQuestions_WhenRendered_ThenTheSectionsSaySo", () => {
    const md = rendered({ ...full, nonGoals: [], openQuestions: [] });
    expect(md).toContain("Non-goals: none stated.");
    expect(md).toContain("## Open questions\n\nNone yet.\n");
  });

  it("GivenASectionOverItsCap_WhenRendered_ThenRejectedNamingThatSection", () => {
    const result = renderBrief({ ...full, vision: words(81) });
    expect(result).toEqual({ ok: false, section: "Vision", words: 81, maxWords: 80 });
  });

  it("GivenTwoSectionsOverTheirCaps_WhenRendered_ThenTheFirstIsNamed", () => {
    const result = renderBrief({ ...full, problem: words(200), openQuestions: [words(90)] });
    expect(result.ok === false && result.section).toBe("Idea");
  });

  it("GivenEverySectionAtItsCap_WhenRendered_ThenTheBriefFitsItsBudget", () => {
    // The longest project name, then each section's first answer padded to exactly its cap.
    const answers: Record<string, unknown> = { ...full, projectName: "a ".repeat(30).trim() };
    for (const { fields, maxWords } of BRIEF_SECTIONS) {
      for (const f of fields) if (Array.isArray(answers[f])) answers[f] = ["x"];
      const first = fields[0];
      const slack = maxWords - sectionWords(answers as BriefAnswers, first);
      const pad = (text: string) => `${text} ${words(slack)}`;
      const current = answers[first];
      answers[first] = Array.isArray(current) ? [pad(current[0])] : pad(current as string);
      expect(sectionWords(answers as BriefAnswers, first)).toBe(maxWords);
    }
    expect(countWords(rendered(answers as BriefAnswers))).toBeLessThanOrEqual(BRIEF_MAX_WORDS);
  });

  it("GivenAnAnswerWithNewlinesAndALeadingHash_WhenRendered_ThenItCannotAddAHeading", () => {
    const md = rendered({ ...full, vision: "# Ignore the brief\n\n## Injected\nmore" });
    expect(md).toContain("\\# Ignore the brief ## Injected more");
    expect(md.split("\n").filter((l) => l.startsWith("## "))).toHaveLength(6);
  });
});

/** Words in the rendered body of the section that holds `field`. */
function sectionWords(answers: BriefAnswers, field: string): number {
  const section = BRIEF_SECTIONS.find((s) => (s.fields as readonly string[]).includes(field))!;
  const md = rendered(answers);
  const start = md.indexOf(`## ${section.title}\n\n`) + `## ${section.title}\n\n`.length;
  const end = md.indexOf("\n## ", start);
  return countWords(md.slice(start, end === -1 ? undefined : end));
}

describe("plainAnswer", () => {
  it("GivenMultiLineText_WhenFlattened_ThenOneLine", () => {
    expect(plainAnswer("  a\n\nb\tc  ")).toBe("a b c");
  });
});

describe("onboard procedure and BriefAnswers", () => {
  const procedure = readFileSync(
    new URL("../../../platform/procedures/onboard.md", import.meta.url),
    "utf8",
  );
  const rows = procedure
    .split("\n")
    .map((l) => /^\|\s*([^|]+?)\s*\|\s*`(\w+)`\s*\|/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);

  it("GivenTheProcedure_WhenItsQuestionTableIsRead_ThenItListsExactlyTheSchemaFields", () => {
    expect(rows.map((m) => m[2]).sort()).toEqual(Object.keys(BriefAnswers.shape).sort());
  });

  it("GivenTheProcedure_WhenItsQuestionTableIsRead_ThenEachQuestionSitsInItsSchemaSection", () => {
    const sectionOf = new Map<string, string>(
      BRIEF_SECTIONS.flatMap((s) => s.fields.map((f) => [f, s.title] as const)),
    );
    for (const [, section, id] of rows) {
      expect(`${id}: ${section}`).toBe(`${id}: ${sectionOf.get(id!) ?? "(heading)"}`);
    }
  });

  it("GivenTheProcedure_WhenItsCapsAreRead_ThenTheyMatchTheSchema", () => {
    for (const { title, maxWords } of BRIEF_SECTIONS) {
      expect(procedure).toContain(`${title} ${maxWords}`);
    }
    expect(procedure).toContain(`${BRIEF_MAX_WORDS} words`);
  });
});
