import type { MergeWaitReason, WaitingMergeQueue } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/api";
import { useMergePr } from "@/lib/queries";

/** Why a PR wasn't merged, in words (ADR-0124); the mode's reasons only show when not waived. */
const WAIT_TEXT: Record<MergeWaitReason, string> = {
  mode_not_set: "no merge mode saved",
  mode_manual: "manual mode",
  mode_epic: "epic mode",
  kept_path: "touches a kept path",
  high_risk_path: "touches a high-risk path",
  accepted_label: "a review finding you accepted",
  gate_not_clean: "checks or reviews haven't all passed",
  not_ready_for_review: "its ticket isn't in Ready for review",
  files_incomplete: "its changed files couldn't all be read",
  labels_unknown: "its labels couldn't be read",
  behind_default_branch: "it lacks the latest main",
  up_to_date_unknown: "whether it has the latest main couldn't be read",
  review_findings_unknown: "its review findings couldn't be read",
  open_review_findings: "a review finding is open",
  main_red: "main is red",
  main_checks_unknown: "main's checks couldn't be read",
};

const reasonText = (r: MergeWaitReason) => WAIT_TEXT[r] ?? r;

/** `owner/repo` of a github.com pull request URL; null for anything else. */
export function repoOfPullRequest(url: string): string | null {
  return (
    /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/pull\/\d+$/.exec(url)?.[1] ?? null
  );
}

/** A queued PR's place and what the queue waits for: "In the merge queue: #1 · sync requested". */
export function queueLine(queue: WaitingMergeQueue): string {
  return `In the merge queue: #${queue.position}${queue.note ? ` · ${queue.note}` : ""}`;
}

/**
 * Andy's Merge (AI-388, ADR-0157): puts the PR in its repo's merge queue with his click as the
 * owner's approval, which waives what the merge mode keeps for him. The line under it says what
 * happened: merged, queued with its place, or what still holds it.
 */
export function MergeButton({
  projectId,
  repo,
  number,
  queue = null,
  variant = "default",
}: {
  projectId: string;
  repo: string;
  number: number;
  /** Its place in the merge queue when it is already queued; null when not. */
  queue?: WaitingMergeQueue | null;
  /** `outline` where another button is the primary one (the ticket panel's move). */
  variant?: "default" | "outline";
}) {
  const merge = useMergePr(projectId);
  const result = merge.data;
  const line = merge.isError
    ? `Not merged: ${errorText(merge.error)}`
    : result?.merged
      ? `Merged PR #${result.number}`
      : result?.queued
        ? queueLine({ position: result.queuePosition ?? 1, note: result.queueNote })
        : result
          ? `Not merged: ${[...result.reasons.map(reasonText), ...(result.queueNote ? [result.queueNote] : [])].join(", ")}`
          : queue
            ? queueLine(queue)
            : null;
  const done = result?.merged === true;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={merge.isPending || done}
        onClick={() => merge.mutate({ repo, number })}
        className="max-sm:min-h-11 max-sm:w-full"
      >
        {merge.isPending ? "Merging…" : `Merge PR #${number}`}
      </Button>
      {line && (
        <p role="status" className="text-sm text-muted-foreground">
          {line}
        </p>
      )}
    </div>
  );
}
