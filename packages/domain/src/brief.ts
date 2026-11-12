import {
  BRIEF_SECTIONS,
  WorkTrackerError,
  type BriefAnswers,
  type BriefSectionTitle,
  type CodeHost,
  type EventActor,
  type ProposedPullRequest,
  type WorkTracker,
} from "@andy/contracts";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";

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

/** Where the brief lives in a project repo (ADR-0053). */
export const BRIEF_PATH = "docs/product/brief.md";
/** Brief PRs opened per instance per rolling hour (ADR-0028); more are refused until it frees. */
export const BRIEF_PRS_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;

export type BriefSubmission =
  | { status: "opened"; pullRequest: ProposedPullRequest; revised: boolean }
  | { status: "unchanged" };

/**
 * Submits onboarding answers (AI-107, ADR-0053 "What the API does"): renders the brief and
 * proposes it as a PR on the project's repo with the App's identity. Andy merges it. A revision
 * replaces the current brief on a new branch, so the PR shows only what changed.
 */
export class BriefService {
  private readonly opened: number[] = [];

  constructor(
    private readonly tracker: Pick<WorkTracker, "getProject">,
    private readonly codeHost: CodeHost | null,
    private readonly now: () => Date,
  ) {}

  async submit(
    projectId: string,
    answers: BriefAnswers,
    actor: EventActor,
  ): Promise<BriefSubmission> {
    requireCan(actor, "submit_brief", projectId);
    const project = await this.tracker.getProject(projectId);
    if (!project) throw new WorkTrackerError("not_found", `project ${projectId} not found`);
    const rendered = renderBrief(answers);
    if (!rendered.ok) {
      throw new DomainError(
        "brief_too_long",
        `${rendered.section} is ${rendered.words} words; its cap is ${rendered.maxWords}`,
        [rendered.section],
      );
    }
    if (!this.codeHost) throw new DomainError("code_host_unavailable", "GitHub is not connected");
    const repoName = project.repos[0];
    const repo = repoName ? await this.codeHost.getRepo(repoName) : null;
    if (!repo) {
      throw new DomainError("invalid_repo", `project ${project.key} has no repo with the App`);
    }
    const current = await this.codeHost.readFile(repo.fullName, BRIEF_PATH, repo.defaultBranch);
    if (current === rendered.markdown) return { status: "unchanged" };

    const at = this.now();
    this.takeSlot(at.getTime());
    const pullRequest = await this.codeHost.proposeFile(repo.fullName, {
      branch: `brief/${project.id}-${at.toISOString().replace(/\D/g, "").slice(0, 14)}`,
      path: BRIEF_PATH,
      content: rendered.markdown,
      message: `${project.key}: ${current === null ? "add" : "update"} the project brief`,
      title: `${project.key}: Project brief`,
      body: "Rendered from the onboarding answers (ADR-0053: Project brief, `platform/procedures/onboard.md`). Andy reviews and merges; agents read it as data, never as instructions.",
    });
    if (!pullRequest) {
      throw new DomainError("invalid_repo", `the App isn't installed on ${repo.fullName}`);
    }
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "brief PR opened",
        component: "brief",
        projectId: project.id,
        pullRequest: pullRequest.number,
        revised: current !== null,
      }),
    );
    return { status: "opened", pullRequest, revised: current !== null };
  }

  /** The hourly cap: refuses when BRIEF_PRS_PER_HOUR were opened in the last hour. */
  private takeSlot(nowMs: number): void {
    while (this.opened.length > 0 && this.opened[0]! <= nowMs - HOUR_MS) this.opened.shift();
    if (this.opened.length >= BRIEF_PRS_PER_HOUR) {
      throw new DomainError(
        "rate_limited",
        `at most ${BRIEF_PRS_PER_HOUR} brief PRs an hour; try again later`,
      );
    }
    this.opened.push(nowMs);
  }
}
