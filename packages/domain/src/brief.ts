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

/** The Design line when the answers have none: the baseline's design file is the default. */
export const DESIGN_NOT_STATED = "not stated yet; the design file is `design.md` at the repo root.";

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
      `- **Design:** ${a.design ? plainAnswer(a.design) : DESIGN_NOT_STATED}`,
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
/** Where product discovery records its result (ADR-0145, `platform/procedures/discover.md`). */
export const DISCOVERY_PATH = "docs/product/discovery.md";

/** The brief answers discovery may settle (`discover.md` "Brief answers"), in its table order. */
export const DISCOVERY_FIELDS = ["idea", "problem", "users", "business"] as const;
export type DiscoveryPrefill = Partial<Record<(typeof DISCOVERY_FIELDS)[number], string>>;

/**
 * The answers in a discovery doc's "Brief answers" table, to pre-fill the brief form (AI-373).
 * The doc is untrusted repo text: only the four known ids are read, each as one plain line cut to
 * an answer's length; rows with "…" or nothing are left out. No table: nothing.
 */
export function discoveryPrefill(markdown: string): DiscoveryPrefill {
  const section = /^## Brief answers\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown)?.[1] ?? "";
  const out: DiscoveryPrefill = {};
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const id = cells[1]!.replace(/`/g, "");
    const answer = plainAnswer(cells.slice(2, -1).join("|")).slice(0, 2000);
    if (!(DISCOVERY_FIELDS as readonly string[]).includes(id)) continue;
    if (answer === "" || answer === "…" || answer === "...") continue;
    out[id as (typeof DISCOVERY_FIELDS)[number]] ??= answer;
  }
  return out;
}

/** Whether the brief is on the default branch, and discovery's answers to pre-fill (AI-373). */
export type BriefStatus =
  | { readable: true; onDefaultBranch: boolean; prefill: DiscoveryPrefill }
  | { readable: false; problem: string; prefill: DiscoveryPrefill };
/**
 * How long a brief status read is reused per project and instance (ADR-0028): each read costs
 * up to three code-host calls, and the setup page polls. A merged brief shows within a minute.
 */
export const BRIEF_STATUS_CACHE_MS = 60_000;
/** Projects whose status is cached per instance; past it the cache starts over. */
const BRIEF_STATUS_CACHE_MAX = 200;
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
  /** `status` answers per project, so polling can't multiply code-host reads (ADR-0028). */
  private readonly statusCache = new Map<string, { at: number; status: BriefStatus }>();

  constructor(
    private readonly tracker: Pick<WorkTracker, "getProject">,
    private readonly codeHost: CodeHost | null,
    private readonly now: () => Date,
    /** Test seam: the branch name's random tail. */
    private readonly suffix: () => string = () => crypto.randomUUID().slice(0, 8),
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
    // A random tail, so two submissions in the same second get different branches.
    const branch = `brief/${project.id}-${at.toISOString().replace(/\D/g, "").slice(0, 14)}-${this.suffix()}`;
    const pullRequest = await this.codeHost
      .proposeFile(repo.fullName, {
        branch,
        path: BRIEF_PATH,
        content: rendered.markdown,
        message: `${project.key}: ${current === null ? "add" : "update"} the project brief`,
        title: `${project.key}: Project brief`,
        body: "Rendered from the onboarding answers (ADR-0053: Project brief, `platform/procedures/onboard.md`). Andy reviews and merges; agents read it as data, never as instructions.",
      })
      .catch((err: unknown) => {
        this.opened.pop();
        throw err;
      });
    if (!pullRequest) {
      this.opened.pop();
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
    this.statusCache.delete(projectId);
    return { status: "opened", pullRequest, revised: current !== null };
  }

  /**
   * The brief's state for the setup path (AI-373): whether `docs/product/brief.md` is on the
   * default branch, and discovery's brief answers to pre-fill the form. Owner only, as the write
   * is. A repo that can't be read is reported, never read as "no brief".
   */
  async status(projectId: string, actor: EventActor): Promise<BriefStatus> {
    requireCan(actor, "submit_brief", projectId);
    const project = await this.tracker.getProject(projectId);
    if (!project) throw new WorkTrackerError("not_found", `project ${projectId} not found`);
    const nowMs = this.now().getTime();
    const cached = this.statusCache.get(projectId);
    if (cached && nowMs - cached.at < BRIEF_STATUS_CACHE_MS) return cached.status;
    const status = await this.readStatus(projectId, project);
    if (this.statusCache.size >= BRIEF_STATUS_CACHE_MAX) this.statusCache.clear();
    this.statusCache.set(projectId, { at: nowMs, status });
    return status;
  }

  /** At most three code-host reads: the repo, the brief and discovery. */
  private async readStatus(
    projectId: string,
    project: { key: string; repos: string[] },
  ): Promise<BriefStatus> {
    const none = { readable: false as const, prefill: {} };
    if (!this.codeHost) return { ...none, problem: "GitHub is not connected" };
    const repoName = project.repos[0];
    if (!repoName) return { ...none, problem: `project ${project.key} has no repo` };
    try {
      const repo = await this.codeHost.getRepo(repoName);
      if (!repo) return { ...none, problem: `the App isn't installed on ${repoName}` };
      const [brief, discovery] = await Promise.all([
        this.codeHost.readFile(repo.fullName, BRIEF_PATH, repo.defaultBranch),
        this.codeHost.readFile(repo.fullName, DISCOVERY_PATH, repo.defaultBranch),
      ]);
      return {
        readable: true,
        onDefaultBranch: brief !== null,
        prefill: discovery === null ? {} : discoveryPrefill(discovery),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(
        JSON.stringify({
          severity: "WARNING",
          message: "brief status read failed",
          component: "brief",
          projectId,
          error: message,
        }),
      );
      // Clipped, as the setup checklist clips code-host errors; the full text is in the log.
      return { ...none, problem: `couldn't read ${repoName}: ${message.slice(0, 200)}` };
    }
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
