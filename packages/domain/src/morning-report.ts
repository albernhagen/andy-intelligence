import type {
  FindingSeverity,
  NightLaunch,
  ReviewFinding,
  ReviewFindingSource,
  Run,
  RunStore,
  Ticket,
  WorkTracker,
} from "@andy/contracts";
import type { TicketService } from "./tickets";
import { NIGHT_END_TEXT } from "./night-budget";
import { mergedStories, type MorningPrOpener, type MorningResult } from "./night-merge";

/**
 * The morning report (AI-125, ADR-0049 "Morning report"): when a night launch ends, one short
 * comment on the epic built from stored facts only (the launch, its stories, their agent tasks,
 * night assumptions and review findings), and the epic flagged Needs-you so the inbox and the
 * Needs-you email show it. A table and links, not a wall of text: agent text appears only as the
 * night assumptions and stop reasons, quoted, escaped and capped.
 */

/** Findings read for the report (ADR-0028): the project's latest reviewed PRs only. */
export const REPORT_FINDING_PULLS = 50;
export const REPORT_FINDING_LIMIT = 300;
/** Characters of one quoted assumption or stop reason. */
export const REPORT_QUOTE_MAX = 240;

const HEADING = "## Morning report";

/** What happened to one story tonight. */
export type StoryResult = "merged" | "done" | "stopped" | "skipped" | "not_started" | "unfinished";

export type StoryReport = {
  key: string;
  result: StoryResult;
  /** Stop reason, or the stopped story a skipped one waits on. */
  reason: string | null;
  pullRequest: { number: number | null; url: string } | null;
  checks: { passed: number; total: number } | null;
  findings: Partial<Record<FindingSeverity, number>>;
  assumptions: string[];
  usd: number;
  tokens: number;
  /** Finished agent tasks with no usage report: their cost is unknown, never $0. */
  unknownCost: number;
};

export type MorningReportInput = {
  launch: NightLaunch;
  stories: StoryReport[];
  morning: MorningResult | null;
  /** The web app's origin for ticket links; "" gives in-app relative links. */
  appUrl: string;
};

const RESULT_TEXT: Record<StoryResult, string> = {
  merged: "merged",
  done: "done",
  stopped: "stopped",
  skipped: "skipped",
  not_started: "not started",
  unfinished: "unfinished",
};

/** Agent text as one escaped, capped line: no markup, links, mentions or line breaks survive. */
export function quoteUntrusted(text: string, max = REPORT_QUOTE_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const capped = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return `“${capped.replace(/[\\`*_[\]<>#|~!@()]/g, "\\$&")}”`;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const tokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : `${n}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const SEVERITY_ORDER: FindingSeverity[] = [
  "blocker",
  "critical",
  "high",
  "should-fix",
  "medium",
  "low",
  "question",
  "info",
];

function findingsText(findings: StoryReport["findings"]): string {
  const parts = SEVERITY_ORDER.filter((s) => findings[s]).map((s) => `${findings[s]} ${s}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

function morningLine(morning: MorningResult | null): string {
  if (!morning) return "Morning PR: none (no code host connected).";
  switch (morning.result) {
    case "opened":
      return `Morning PR: [#${morning.number}](${morning.url}).`;
    case "exists":
      return "Morning PR: already open from the epic branch.";
    case "deleted":
      return "Morning PR: none; nothing merged, so the epic branch was deleted.";
    case "kept":
      return "Morning PR: none; nothing merged tonight, and the epic branch keeps an earlier night's work.";
    case "skipped":
      return `Morning PR: none (${morning.reason.replace(/_/g, " ")}).`;
    case "failed":
      return "Morning PR: couldn't be opened; see the comment above.";
  }
}

/** The first line of a report for this launch: how a second build finds the first. */
export const reportMarker = (launch: Pick<NightLaunch, "epicKey" | "id">) =>
  `${HEADING}: night launch of ${launch.epicKey} (${launch.id})`;

/** The report's markdown. Pure: everything comes from `input`. */
export function morningReport({ launch, stories, morning, appUrl }: MorningReportInput): string {
  const link = (key: string) =>
    `[${key}](${appUrl}/p/${encodeURIComponent(launch.projectId)}/t/${key})`;
  const count = (r: StoryResult) => stories.filter((s) => s.result === r).length;
  const spent = stories.reduce((n, s) => n + s.usd, 0);
  const used = stories.reduce((n, s) => n + s.tokens, 0);
  const unknown = stories.reduce((n, s) => n + s.unknownCost, 0);
  const ended = launch.endReason ? NIGHT_END_TEXT[launch.endReason] : "it ended";

  const lines = [
    reportMarker(launch),
    "",
    `Ended because ${ended}. Of ${plural(stories.length, "story", "stories")}: ${count("merged")} merged, ${count("done")} done, ${count("stopped")} stopped, ${count("skipped") + count("not_started")} not started, ${count("unfinished")} unfinished.`,
    `Spend: ${usd(spent)} of ${usd(launch.budget.maxUsd)}, ${tokens(used)} of ${tokens(launch.budget.maxTokens)} tokens${unknown > 0 ? `, ${plural(unknown, "agent task")} with unknown cost` : ""}.`,
    morningLine(morning),
    "",
    "| Story | Result | PR | Checks | Review findings | Night assumptions | Cost |",
    "| ----- | ------ | -- | ------ | --------------- | ----------------- | ---- |",
  ];
  for (const s of stories) {
    const pr = s.pullRequest
      ? `[${s.pullRequest.number === null ? "PR" : `#${s.pullRequest.number}`}](${s.pullRequest.url})`
      : "—";
    const checks = s.checks ? `${s.checks.passed}/${s.checks.total} passed` : "—";
    lines.push(
      `| ${link(s.key)} | ${RESULT_TEXT[s.result]} | ${pr} | ${checks} | ${findingsText(s.findings)} | ${s.assumptions.length} | ${usd(s.usd)} · ${tokens(s.tokens)} |`,
    );
  }

  const held = stories.filter((s) => s.reason !== null);
  if (held.length > 0) {
    lines.push("", "**Stopped or not started**", "");
    for (const s of held) lines.push(`- ${link(s.key)} ${RESULT_TEXT[s.result]}: ${s.reason}`);
  }
  const assumed = stories.filter((s) => s.assumptions.length > 0);
  if (assumed.length > 0) {
    lines.push("", "**Night assumptions, to review** (agent text)", "");
    for (const s of assumed)
      for (const a of s.assumptions) lines.push(`- ${link(s.key)}: ${quoteUntrusted(a)}`);
  }
  lines.push(
    "",
    "Review findings and how each was answered are on each story's PR; plans and check output are on each story's agent task.",
  );
  return lines.join("\n");
}

const PULL_NUMBER = /\/pull\/(\d+)(?:$|[/?#])/;

/** One story's report from its ticket, its agent tasks since the launch began and the findings. */
export function storyReport(
  launch: NightLaunch,
  story: Ticket,
  runs: readonly Run[],
  findings: readonly ReviewFinding[],
  merged: ReadonlySet<string>,
): StoryReport {
  const since = launch.startedAt ?? launch.createdAt;
  const tonight = runs.filter((r) => (r.createdAt ?? "") >= since);
  const stopped = launch.stoppedStories.find((s) => s.key === story.key);
  const waitsOn = launch.stoppedStories.find((s) => s.skipped.includes(story.key));
  const builds = tonight
    .filter((r) => r.step === "build")
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const latest = builds[0] ?? null;
  const prUrl = builds.find((r) => r.links.pullRequest)?.links.pullRequest ?? null;
  const prNumber = prUrl ? Number(PULL_NUMBER.exec(prUrl)?.[1] ?? NaN) : NaN;

  const result: StoryResult = merged.has(story.key)
    ? "merged"
    : story.stage === "done"
      ? "done"
      : stopped
        ? "stopped"
        : waitsOn
          ? "skipped"
          : tonight.length === 0
            ? "not_started"
            : "unfinished";
  const reason =
    result === "stopped"
      ? quoteUntrusted(stopped!.reason)
      : result === "skipped"
        ? `waits on ${waitsOn!.key}, which stopped`
        : result === "not_started"
          ? "no agent task started before the launch ended"
          : null;

  const counted: StoryReport["findings"] = {};
  if (Number.isInteger(prNumber))
    for (const f of findings)
      if (f.pullNumber === prNumber) counted[f.severity] = (counted[f.severity] ?? 0) + 1;

  return {
    key: story.key,
    result,
    reason,
    pullRequest: prUrl
      ? { number: Number.isInteger(prNumber) ? prNumber : null, url: prUrl }
      : null,
    checks:
      latest && latest.verification.length > 0
        ? {
            passed: latest.verification.filter((c) => c.passed).length,
            total: latest.verification.length,
          }
        : null,
    findings: counted,
    assumptions: story.refineAssumptions
      .filter((a) => a.nightLaunchId === launch.id)
      .map((a) => a.text),
    usd: tonight.reduce((n, r) => n + (r.costUsd ?? 0), 0),
    tokens: tonight.reduce((n, r) => n + (r.tokensIn ?? 0) + (r.tokensOut ?? 0), 0),
    unknownCost: tonight.filter((r) => r.costUsd === null && r.endedAt !== null).length,
  };
}

/** Posts the report once per launch and flags the epic. */
export class MorningReports {
  constructor(
    private readonly tracker: Pick<WorkTracker, "getTicketByKey" | "listEvents" | "addComment">,
    private readonly runs: Pick<RunStore, "listForTicket">,
    private readonly tickets: Pick<TicketService, "flag">,
    /** The web app's origin for links; "" for in-app relative links. */
    private readonly appUrl: string,
    /** Null when review findings aren't recorded: the column then reads "none". */
    private readonly findings: ReviewFindingSource | null = null,
  ) {}

  /**
   * Never throws: a failure is logged, since nothing calls this again once the launch has
   * ended. Returns whether a report was posted (false when one already exists or it failed).
   */
  async post(launch: NightLaunch, morning: MorningResult | null): Promise<boolean> {
    try {
      return await this.write(launch, morning);
    } catch (err) {
      log("ERROR", "morning report failed", {
        launchId: launch.id,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
      });
      return false;
    }
  }

  private async write(launch: NightLaunch, morning: MorningResult | null): Promise<boolean> {
    if (launch.status !== "ended") return false;
    const marker = reportMarker(launch);
    const events = await this.tracker.listEvents(launch.projectId, launch.epicId);
    if (events.some((e) => e.kind === "comment" && e.body?.startsWith(marker))) {
      log("INFO", "morning report already posted", { launchId: launch.id });
      return false;
    }
    // By key, not the whole project (ADR-0126): one ticket read and one run list per story, at
    // most `NIGHT_LIMITS.maxStories` (ADR-0028), plus one capped findings read.
    const stories = (
      await Promise.all(
        launch.storyKeys.map((k) => this.tracker.getTicketByKey(launch.projectId, k)),
      )
    ).filter((t): t is Ticket => t !== null);
    const runs = await Promise.all(
      stories.map((t) => this.runs.listForTicket(launch.projectId, t.id)),
    );
    const findings = this.findings
      ? await this.findings.recent(launch.projectId, {
          maxPulls: REPORT_FINDING_PULLS,
          maxFindings: REPORT_FINDING_LIMIT,
        })
      : [];
    const merged = new Set(mergedStories(launch, stories, runs.flat()).map((m) => m.key));
    const body = morningReport({
      launch,
      stories: stories.map((t, i) => storyReport(launch, t, runs[i]!, findings, merged)),
      morning,
      appUrl: this.appUrl,
    });
    await this.tracker.addComment(launch.projectId, launch.epicId, body, "system");
    await this.tickets.flag(launch.projectId, launch.epicId, "system");
    log("INFO", "morning report posted", { launchId: launch.id, stories: stories.length });
    return true;
  }
}

/**
 * What runs when a launch ends: the morning PR (when a code host is connected), then the report,
 * which links it. Both are safe to run twice.
 */
export class MorningSteps implements MorningPrOpener {
  constructor(
    private readonly pullRequests: MorningPrOpener | null,
    private readonly reports: Pick<MorningReports, "post">,
  ) {}

  async open(launch: NightLaunch): Promise<MorningResult> {
    const result = this.pullRequests ? await this.pullRequests.open(launch) : null;
    await this.reports.post(launch, result);
    return result ?? { result: "skipped", reason: "no_repo" };
  }
}

function log(severity: string, message: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ severity, message, component: "morning-report", ...fields }));
}
