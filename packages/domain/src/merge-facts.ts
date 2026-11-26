import type {
  CodeHost,
  HeadCheck,
  Listing,
  MergeMode,
  Project,
  PullRequest,
  RequiredCheck,
  ReviewFindingSource,
  Ticket,
  WorkTracker,
} from "@andy/contracts";
import { REVIEW_CHECKS } from "./gate";
import { effectiveTicketMergeMode } from "./merge-mode";
import { openFindingsOn, type MainChecks } from "./merge-verdict";
import { cascadesFrom } from "./overrides";

/**
 * Reads for the merge verdict (ADR-0124) that the gate (agent PRs) and MCP `merge_pr` (session
 * PRs, AI-220) share, so both judge a PR from the same facts.
 */

/** Review findings read per verdict (ADR-0028): the project's latest reviewed PRs only. */
const FINDING_PULLS = 30;
const FINDING_LIMIT = 300;

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 2000);

/**
 * The ticket's mode: the stricter of the project's saved mode, its epic's override and its own
 * (`effectiveTicketMergeMode`). A project with no saved mode stays unset, so nothing merges
 * (ADR-0134).
 */
export async function ticketMergeMode(
  tracker: Pick<WorkTracker, "getTicket">,
  project: Pick<Project, "mergeMode">,
  ticket: Ticket,
): Promise<MergeMode | null> {
  if (project.mergeMode === null) return null;
  const epic = ticket.parentId
    ? cascadesFrom(await tracker.getTicket(ticket.projectId, ticket.parentId))
    : null;
  const withEpic = effectiveTicketMergeMode(project, epic?.overrides.mergeMode);
  return effectiveTicketMergeMode({ mergeMode: withEpic }, ticket.overrides.mergeMode);
}

/**
 * Open findings recorded for this head. Without a source, 0: the review checks fail on every
 * open finding (ADR-0134, Andy's answer (a)), so a clean gate already means none, and an
 * override label makes the verdict wait. With one, null (wait) when the read fails or may
 * have been cut short: `recent` returns the newest PRs' findings, so a PR missing from a full
 * page (or a read at the findings cap) may have findings it didn't return.
 */
export async function openFindingsFor(
  findings: ReviewFindingSource | null,
  projectId: string,
  repo: string,
  pr: Pick<PullRequest, "number" | "headSha">,
  component: string,
): Promise<number | null> {
  if (!findings) return 0;
  try {
    const recent = await findings.recent(projectId, {
      maxPulls: FINDING_PULLS,
      maxFindings: FINDING_LIMIT,
    });
    const pulls = new Set(recent.map((f) => `${f.repo}#${f.pullNumber}`));
    const listed = pulls.has(`${repo}#${pr.number}`);
    if (recent.length >= FINDING_LIMIT || (!listed && pulls.size >= FINDING_PULLS)) return null;
    return openFindingsOn(recent, { repo, number: pr.number, headSha: pr.headSha });
  } catch (err) {
    console.log(
      JSON.stringify({
        severity: "WARNING",
        message: "review findings read failed",
        component,
        pr: pr.number,
        error: errorText(err),
      }),
    );
    return null;
  }
}

const passes = (c: HeadCheck) => ["success", "neutral", "skipped"].includes(c.conclusion ?? "");

/** The `mainChecks` fact for a PR not into the default branch: main's checks don't apply. */
export const NOT_MAIN: MainChecks = { state: "passed", failing: [] };

/**
 * The default branch's own state (AI-382, ADR-0154) from its required checks on its head:
 * `failed` when every run of a required check has completed and one didn't pass, `running` when
 * one hasn't completed or reported yet (a re-run of a failed check counts as running), else
 * `passed`. The review checks are left out: they run on PRs, never on a push. A listing cut short
 * with no failure in it is unknown (null): it never counts as green.
 */
export function mainChecksOf(
  required: readonly RequiredCheck[],
  checks: Listing<HeadCheck>,
): MainChecks | null {
  const failing: string[] = [];
  let running = false;
  for (const want of required.filter((r) => !REVIEW_CHECKS.includes(r.name))) {
    const found = checks.items.filter(
      (c) => c.name === want.name && (want.sourceId === null || c.sourceId === want.sourceId),
    );
    if (found.length === 0 || found.some((c) => c.status !== "completed")) running = true;
    else if (!found.every(passes)) failing.push(want.name);
  }
  if (failing.length > 0) return { state: "failed", failing: [...new Set(failing)] };
  if (!checks.complete) return null;
  return { state: running ? "running" : "passed", failing: [] };
}

/**
 * Reads `mainChecksOf` for the default branch's tip `tipSha` (the tip the verdict judges the PR
 * against). Null (wait) with no tip or when a read fails; a failure is logged with `component`.
 */
export async function readMainChecks(
  host: Pick<CodeHost, "listRequiredChecks" | "listHeadChecks">,
  repo: string,
  branch: string,
  tipSha: string | null,
  component: string,
): Promise<MainChecks | null> {
  if (!tipSha) return null;
  try {
    const [required, checks] = await Promise.all([
      host.listRequiredChecks(repo, branch),
      host.listHeadChecks(repo, tipSha),
    ]);
    return mainChecksOf(required, checks);
  } catch (err) {
    console.log(
      JSON.stringify({
        severity: "WARNING",
        message: "default branch checks read failed",
        component,
        repo,
        error: errorText(err),
      }),
    );
    return null;
  }
}
