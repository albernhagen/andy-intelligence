import { BriefAnswers } from "@andy/contracts";

/**
 * The brief form's model (AI-373): the onboarding interview's answers (`onboard.md`, the same
 * `BriefAnswers` MCP `submit_brief` takes) asked as four short pages. Lists are typed one item
 * per line. The draft is kept in this browser as Andy types (a per-viewer convenience), so
 * "Save and finish later" loses nothing; the brief itself is stored only when it is submitted.
 */

export type BriefDraft = Record<DraftField, string>;

export type DraftField =
  | "idea"
  | "problem"
  | "users"
  | "business"
  | "vision"
  | "goals"
  | "nonGoals"
  | "stack"
  | "cloud"
  | "environments"
  | "constraints"
  | "qualityBar"
  | "design"
  | "openQuestions";

export interface DraftQuestion {
  field: DraftField;
  label: string;
  placeholder: string;
  optional?: boolean;
  /** Typed one item per line. */
  list?: boolean;
}

export interface BriefPage {
  title: string;
  questions: DraftQuestion[];
}

export const BRIEF_PAGES: readonly BriefPage[] = [
  {
    title: "What are you building, and for whom?",
    questions: [
      { field: "idea", label: "The idea", placeholder: "In a sentence or two" },
      { field: "problem", label: "The problem it solves", placeholder: "What hurts today" },
      { field: "users", label: "Who uses it", placeholder: "Me first, then…" },
      { field: "business", label: "Business", placeholder: "Revenue intent, or none" },
    ],
  },
  {
    title: "What is true when version one is done?",
    questions: [
      { field: "vision", label: "Vision", placeholder: "What a good day with it looks like" },
      {
        field: "goals",
        label: "Goals, most important first",
        placeholder: "One per line",
        list: true,
      },
      {
        field: "nonGoals",
        label: "Non-goals",
        placeholder: "Optional: one per line",
        optional: true,
        list: true,
      },
    ],
  },
  {
    title: "How should it be built?",
    questions: [
      { field: "stack", label: "Stack", placeholder: "Languages, frameworks" },
      { field: "cloud", label: "Cloud", placeholder: "Where it runs" },
      { field: "environments", label: "Environments", placeholder: "Dev, prod…" },
      { field: "qualityBar", label: "Quality bar", placeholder: "Tests, reviews, uptime" },
      {
        field: "design",
        label: "Design",
        placeholder: "Optional: direction, or where the design file lives",
        optional: true,
      },
    ],
  },
  {
    title: "Anything it must not do or cost?",
    questions: [
      {
        field: "constraints",
        label: "Constraints",
        placeholder: "Limits, budget, things to avoid",
      },
      {
        field: "openQuestions",
        label: "Open questions",
        placeholder: "Optional: one per line",
        optional: true,
        list: true,
      },
    ],
  },
];

export const EMPTY_DRAFT: BriefDraft = {
  idea: "",
  problem: "",
  users: "",
  business: "",
  vision: "",
  goals: "",
  nonGoals: "",
  stack: "",
  cloud: "",
  environments: "",
  constraints: "",
  qualityBar: "",
  design: "",
  openQuestions: "",
};

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

/** The questions on a page still unanswered (optional ones never are). */
export function missingOn(page: BriefPage, draft: BriefDraft): DraftQuestion[] {
  return page.questions.filter((q) => !q.optional && draft[q.field].trim() === "");
}

/** The answers MCP `submit_brief` takes, checked by the same schema; null while incomplete. */
export function toAnswers(projectName: string, draft: BriefDraft): BriefAnswers | null {
  const parsed = BriefAnswers.safeParse({
    projectName,
    idea: draft.idea,
    problem: draft.problem,
    users: draft.users,
    business: draft.business,
    vision: draft.vision,
    goals: lines(draft.goals),
    nonGoals: lines(draft.nonGoals),
    stack: draft.stack,
    cloud: draft.cloud,
    environments: draft.environments,
    constraints: draft.constraints,
    qualityBar: draft.qualityBar,
    ...(draft.design.trim() ? { design: draft.design } : {}),
    openQuestions: lines(draft.openQuestions),
  });
  return parsed.success ? parsed.data : null;
}

const key = (projectId: string) => `brief-draft:${projectId}`;

/** The saved draft, or null. Storage can be missing or blocked: then nothing is remembered. */
export function loadDraft(projectId: string): BriefDraft | null {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<BriefDraft>;
    return { ...EMPTY_DRAFT, ...pickStrings(data) };
  } catch {
    return null;
  }
}

export function saveDraft(projectId: string, draft: BriefDraft): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(draft));
  } catch {
    // A per-viewer convenience: without storage the form still works.
  }
}

export function clearDraft(projectId: string): void {
  try {
    localStorage.removeItem(key(projectId));
  } catch {
    // Nothing to clear.
  }
}

function pickStrings(data: Partial<BriefDraft>): Partial<BriefDraft> {
  const out: Partial<BriefDraft> = {};
  for (const field of Object.keys(EMPTY_DRAFT) as DraftField[]) {
    if (typeof data[field] === "string") out[field] = data[field];
  }
  return out;
}

/** A new draft from discovery's answers (`docs/product/discovery.md`), when there is no draft. */
export function draftFrom(prefill: Partial<Record<DraftField, string>>): BriefDraft {
  return { ...EMPTY_DRAFT, ...pickStrings(prefill) };
}

/** The brief PR opened from this browser, so the step can link it until it merges. */
export interface OpenedBrief {
  number: number;
  url: string;
}

const prKey = (projectId: string) => `brief-pr:${projectId}`;

export function loadOpenedBrief(projectId: string): OpenedBrief | null {
  try {
    const raw = localStorage.getItem(prKey(projectId));
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<OpenedBrief>;
    // Only a GitHub https link is rendered as the PR's href; anything else is ignored.
    return typeof data.number === "number" &&
      typeof data.url === "string" &&
      data.url.startsWith("https://github.com/")
      ? { number: data.number, url: data.url }
      : null;
  } catch {
    return null;
  }
}

export function saveOpenedBrief(projectId: string, pr: OpenedBrief): void {
  try {
    localStorage.setItem(prKey(projectId), JSON.stringify(pr));
  } catch {
    // The step still says a PR was opened until the page reloads.
  }
}
