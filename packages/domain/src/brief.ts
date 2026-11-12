import { BRIEF_SECTIONS, type BriefAnswers, type BriefSectionTitle } from "@andy/contracts";

/**
 * Renders the onboarding interview's answers as `docs/product/brief.md` (ADR-0053: Project
 * brief, AI-93). A plain template: no model call. Each section is checked against its word cap
 * so the brief stays within its context budget; the first section over its cap is reported.
 */

export type BriefRender =
  | { ok: true; markdown: string }
  | { ok: false; section: BriefSectionTitle; words: number; maxWords: number };

/** Words as `scripts/context-budget.mjs` counts them. */
export function countWords(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

/**
 * One answer as one line of plain text: whitespace collapsed, and a leading `#` escaped, so an
 * answer can't add a heading or break the brief's fixed sections.
 */
export function plainAnswer(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.startsWith("#") ? `\\${line}` : line;
}

const bullets = (items: string[]) => items.map((i) => `- ${plainAnswer(i)}`).join("\n");

const SECTION_BODIES: Record<BriefSectionTitle, (a: BriefAnswers) => string> = {
  Idea: (a) => `${plainAnswer(a.idea)}\n\n${plainAnswer(a.problem)}`,
  "Users and business": (a) =>
    `- **Users:** ${plainAnswer(a.users)}\n- **Business:** ${plainAnswer(a.business)}`,
  Vision: (a) => plainAnswer(a.vision),
  "Goals and non-goals": (a) => {
    const goals = a.goals.map((g, i) => `${i + 1}. ${plainAnswer(g)}`).join("\n");
    const nonGoals =
      a.nonGoals.length === 0 ? "Non-goals: none stated." : `Non-goals:\n\n${bullets(a.nonGoals)}`;
    return `Goals, in priority order:\n\n${goals}\n\n${nonGoals}`;
  },
  "Architectural expectations": (a) =>
    [
      `- **Stack:** ${plainAnswer(a.stack)}`,
      `- **Cloud:** ${plainAnswer(a.cloud)}`,
      `- **Environments:** ${plainAnswer(a.environments)}`,
      `- **Constraints:** ${plainAnswer(a.constraints)}`,
      `- **Quality bar:** ${plainAnswer(a.qualityBar)}`,
    ].join("\n"),
  "Open questions": (a) => (a.openQuestions.length === 0 ? "None yet." : bullets(a.openQuestions)),
};

export function renderBrief(answers: BriefAnswers): BriefRender {
  const parts = [
    `# Project brief — ${plainAnswer(answers.projectName)}`,
    "The product and domain context agents read (ADR-0053: Project brief). Written by the onboarding interview (`platform/procedures/onboard.md`); change it through a PR.",
  ];
  for (const { title, maxWords } of BRIEF_SECTIONS) {
    const body = SECTION_BODIES[title](answers);
    const words = countWords(body);
    if (words > maxWords) return { ok: false, section: title, words, maxWords };
    parts.push(`## ${title}`, body);
  }
  return { ok: true, markdown: `${parts.join("\n\n")}\n` };
}
