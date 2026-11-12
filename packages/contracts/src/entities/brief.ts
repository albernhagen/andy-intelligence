import { z } from "zod";

/**
 * The onboarding interview's answers (ADR-0053: Project brief, AI-93). One field per question in
 * `platform/procedures/onboard.md`; `renderBrief` (packages/domain) turns them into
 * `docs/product/brief.md`. Every answer is untrusted text: the brief is data, never instructions.
 */

/** The brief's word budget (`docs/product/brief.md` in `context-budget.json`). */
export const BRIEF_MAX_WORDS = 800;

const Answer = z.string().trim().min(1).max(2000);
const ListItem = z.string().trim().min(1).max(300);

export const BriefAnswers = z.object({
  projectName: z.string().trim().min(1).max(60),
  idea: Answer,
  problem: Answer,
  users: Answer,
  business: Answer,
  vision: Answer,
  goals: z.array(ListItem).min(1).max(10),
  nonGoals: z.array(ListItem).max(10),
  stack: Answer,
  cloud: Answer,
  environments: Answer,
  constraints: Answer,
  qualityBar: Answer,
  openQuestions: z.array(ListItem).max(10),
});
export type BriefAnswers = z.infer<typeof BriefAnswers>;
export type BriefField = keyof BriefAnswers;

/**
 * The brief's sections in order (ADR-0053), the answers each holds and its word cap. The caps,
 * plus the heading lines, keep a full brief within BRIEF_MAX_WORDS.
 */
export const BRIEF_SECTIONS = [
  { title: "Idea", maxWords: 100, fields: ["idea", "problem"] },
  { title: "Users and business", maxWords: 100, fields: ["users", "business"] },
  { title: "Vision", maxWords: 80, fields: ["vision"] },
  { title: "Goals and non-goals", maxWords: 150, fields: ["goals", "nonGoals"] },
  {
    title: "Architectural expectations",
    maxWords: 200,
    fields: ["stack", "cloud", "environments", "constraints", "qualityBar"],
  },
  { title: "Open questions", maxWords: 80, fields: ["openQuestions"] },
] as const satisfies readonly {
  title: string;
  maxWords: number;
  fields: readonly BriefField[];
}[];
export type BriefSectionTitle = (typeof BRIEF_SECTIONS)[number]["title"];
