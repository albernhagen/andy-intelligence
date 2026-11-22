import type { CodeHost, Project, WorkTracker } from "@andy/contracts";
import manifestFile from "../../../../platform/baseline/manifest.json";
import { renderFiles, type Manifest } from "../../../../platform/baseline/files.mjs";
import {
  checkSections,
  CONFIG_FILES,
  configFor,
  parseConfig,
  SECTIONS,
  type Gh,
  type SectionResult,
} from "../../../../platform/baseline/github.mjs";
import {
  pathsToRead,
  planBaselinePr,
  renderReport,
  type BaselinePlan,
} from "../../../../platform/baseline/plan.mjs";

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "baseline-pr", ...fields }));
}

/** The repo the baseline is rendered from, and the branch its files are read at. */
export const BASELINE_SOURCE = manifestFile.source;
export const BASELINE_REF = "main";
/** Caps on one baseline PR's reads (ADR-0028): source files, target files. */
export const MAX_SOURCE_READS = 60;
export const MAX_TARGET_READS = 40;
/** A Needs-you ticket's body stays under this; the PR holds the full report. */
const MAX_TICKET_BODY = 4000;

/** What happened for one repo; every outcome but `opened` puts a ticket in Needs-you. */
export type BaselineOutcome =
  | { kind: "source" }
  | { kind: "opened"; url: string; plan: BaselinePlan }
  | { kind: "nothing_to_write"; ticket: string }
  | { kind: "empty_repo"; ticket: string }
  | { kind: "failed"; ticket: string | null; error: string };

class EmptyRepo extends Error {}

/**
 * Opens a registered repo's first PR with the project baseline and its report (AI-113): the App
 * writes only files that are missing (never workflows or agent settings), reports what differs,
 * and reports GitHub settings for Andy to apply. Never throws: whatever stops the PR becomes a
 * Needs-you ticket in the project, with the error and the command that does it by hand.
 */
export class BaselineProposer {
  constructor(
    private readonly codeHost: CodeHost,
    private readonly tracker: WorkTracker,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async onRepoRegistered(project: Project, repo: string): Promise<BaselineOutcome> {
    // The baseline source keeps its own files and settings (out of scope for AI-113).
    if (repo.toLowerCase() === BASELINE_SOURCE.toLowerCase()) return { kind: "source" };
    let sha: string | null = null;
    try {
      sha = await this.codeHost.branchSha(BASELINE_SOURCE, BASELINE_REF);
      if (!sha)
        throw new Error(
          `can't read ${BASELINE_SOURCE}@${BASELINE_REF}: is the App installed there?`,
        );
      return await this.propose(project, repo, sha);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const empty = err instanceof EmptyRepo;
      log(empty ? "INFO" : "ERROR", empty ? "baseline repo empty" : "baseline pr failed", {
        projectId: project.id,
        repo,
        error,
      });
      const command = `node platform/baseline/baseline.mjs onboard ${repo} --ref ${sha ?? BASELINE_REF}`;
      const ticket = await this.needsYou(
        project,
        empty ? `Baseline for ${repo}: the repo is empty` : `Baseline PR for ${repo} failed`,
        [
          empty
            ? `${repo} has no commits yet, so the App has nothing to open a PR against. The CLI pushes the baseline (with the starter and its lockfile, which need \`pnpm install\`) and applies the GitHub settings with your login.`
            : `The App couldn't open the baseline PR in ${repo}: ${error}`,
          "",
          "From an up-to-date andy-intelligence checkout (runbook `docs/runbooks/onboard-a-repo.md`):",
          "",
          "```bash",
          command,
          "```",
        ].join("\n"),
      );
      return empty
        ? { kind: "empty_repo", ticket: ticket ?? "" }
        : { kind: "failed", ticket, error };
    }
  }

  private async propose(project: Project, repo: string, sha: string): Promise<BaselineOutcome> {
    const source = await this.sourceReader(sha);
    const manifest = JSON.parse(await source("platform/baseline/manifest.json")) as Manifest;
    const froms = [
      ...new Set(
        [...manifest.managed, ...manifest.lines, ...manifest.seed, ...manifest.starter].map(
          (f) => f.from,
        ),
      ),
    ];
    const configPaths = CONFIG_FILES.map((f) => `platform/baseline/github/${f}`);
    if (froms.length + configPaths.length + 1 > MAX_SOURCE_READS) {
      throw new Error(`the baseline names more than ${MAX_SOURCE_READS} source files`);
    }
    const texts = new Map<string, string>();
    for (const from of [...froms, ...configPaths]) texts.set(from, await source(from));
    const rendered = renderFiles(manifest, (from) => texts.get(from)!, { sha, ref: BASELINE_REF });

    const target = await this.codeHost.getRepo(repo);
    if (!target) throw new Error(`the App isn't installed on ${repo}`);
    const tip = await this.codeHost.branchSha(repo, target.defaultBranch);
    if (!tip) throw new EmptyRepo(`${repo} has no ${target.defaultBranch} yet`);
    const paths = [...new Set(pathsToRead(rendered))];
    if (paths.length > MAX_TARGET_READS) {
      throw new Error(`the baseline reads more than ${MAX_TARGET_READS} files in the repo`);
    }
    const have = new Map<string, string | null>();
    for (const p of paths) have.set(p, await this.codeHost.readFile(repo, p, tip));

    const plan = planBaselinePr(rendered, have, {
      source: manifest.source,
      sha,
      ref: BASELINE_REF,
      date: this.now().toISOString().slice(0, 10),
    });
    const config = configFor(
      parseConfig((name) => texts.get(`platform/baseline/github/${name}`)!),
      target.fullName,
      manifest.source,
    );
    const settings = await this.readSettings(target.fullName, config);
    const branch = `baseline/${sha.slice(0, 7)}`;
    const report = renderReport({
      repo: target.fullName,
      source: manifest.source,
      sha,
      ref: BASELINE_REF,
      branch,
      plan,
      settings,
    });
    const title = `Project baseline ${BASELINE_REF} (${sha.slice(0, 7)})`;

    if (plan.files.length === 0) {
      log("INFO", "baseline pr not needed", { projectId: project.id, repo: target.fullName });
      const ticket = await this.needsYou(
        project,
        `Baseline for ${target.fullName}: nothing for the App to add`,
        report,
      );
      return { kind: "nothing_to_write", ticket: ticket ?? "" };
    }
    const pr = await this.codeHost.proposeFiles(target.fullName, {
      branch,
      files: plan.files,
      message: title,
      title,
      body: report,
    });
    if (!pr) throw new Error(`the App isn't installed on ${repo}`);
    log("INFO", "baseline pr opened", {
      projectId: project.id,
      repo: target.fullName,
      pr: pr.number,
      files: plan.files.length,
      differs: plan.differs.length,
      held: plan.held.length,
    });
    return { kind: "opened", url: pr.url, plan };
  }

  /** Reads one source file at `sha`; a missing file throws (the manifest names it). */
  private async sourceReader(sha: string) {
    return async (path: string): Promise<string> => {
      const text = await this.codeHost.readFile(BASELINE_SOURCE, path, sha);
      if (text === null) throw new Error(`${BASELINE_SOURCE}@${sha.slice(0, 7)} has no ${path}`);
      return text;
    };
  }

  /**
   * The GitHub settings, read-only with the App's identity (no administration permission, so
   * some sections come back unreadable). A failed read is reported, not thrown: settings never
   * stop the PR.
   */
  private async readSettings(repo: string, config: ReturnType<typeof configFor>) {
    const prefix = `repos/${repo}`;
    const gh: Gh = async (method, path) => {
      if (method !== "GET") throw new Error(`the baseline report only reads settings (${method})`);
      if (path !== prefix && !path.startsWith(`${prefix}/`)) {
        throw new Error(`settings read outside ${repo}: ${path}`);
      }
      const read = await this.codeHost.readRepoSetting(repo, path.slice(prefix.length + 1));
      return read ?? { status: 404, data: null };
    };
    // One section at a time, so a failed read (not a refusal) costs only its own section.
    const results: SectionResult[] = [];
    for (const { name } of SECTIONS) {
      try {
        results.push(...(await checkSections(gh, repo, config, [name])));
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log("WARNING", "baseline setting unread", { repo, section: name, error });
        results.push({ section: name, status: "unreadable", diffs: [], error });
      }
    }
    return { results };
  }

  /** A ticket in the project with `needsAttention`, so it shows in Needs-you; its key, or null. */
  private async needsYou(project: Project, title: string, body: string): Promise<string | null> {
    try {
      const ticket = await this.tracker.createTicket(
        project.id,
        {
          title,
          type: "chore",
          body:
            body.length > MAX_TICKET_BODY
              ? `${body.slice(0, MAX_TICKET_BODY - 40)}\n\n(cut; the PR has the full report)`
              : body,
          needsAttention: true,
        },
        "system",
      );
      return ticket.key;
    } catch (err) {
      log("ERROR", "baseline needs-you ticket not created", {
        projectId: project.id,
        title,
        error: String(err),
      });
      return null;
    }
  }
}
