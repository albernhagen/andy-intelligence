import {
  DIGEST_OPEN_PRS_MAX,
  type DigestOpenPr,
  type GateReason,
  type MergeWaitReason,
  type Run,
  type Ticket,
  type TicketEvent,
} from "@andy/contracts";
import type { MergeHold } from "./merge-holds";
import { pullRequestRef } from "./waiting-merges";

/**
 * Open PRs and why each waits (AI-385), for the digest's handover. The reasons are the ones the
 * merge gate recorded on the build's agent task when it last judged the PR's head
 * (`mergeVerdict` → `verdictReasons`, `gateReasons`), the same record the Needs-you "waiting
 * merges" list reads; nothing is judged again here and nothing is read from the code host.
 * A red main is named from the merge queue's hold (AI-382), which is kept current.
 */

/** One plain sentence per merge-verdict reason, for a reader with no context. */
export const MERGE_WAIT_TEXT: Record<Exclude<MergeWaitReason, "main_red">, string> = {
  mode_not_set: "Waits for Andy: the project has no merge mode saved, so nothing merges on its own",
  mode_manual: "Waits for Andy: the merge mode is manual, so he merges every PR",
  mode_epic: "Waits for its epic: in epic mode a story merges into its epic's branch, not main",
  gate_not_clean: "The merge gate's checks aren't all clear",
  kept_path: "Waits for Andy: it changes a path on his kept list, which only he merges",
  high_risk_path: "Waits for Andy: it changes a high-risk path, which low-risk mode leaves to him",
  files_incomplete: "Its changed files couldn't all be listed, so it can't be judged",
  labels_unknown: "Its labels couldn't be read, so it waits",
  accepted_label:
    "Waits for Andy: it carries review-accepted or security-accepted, which only he merges",
  behind_default_branch: "It is behind main: it needs a sync with main before it can merge",
  up_to_date_unknown: "Whether it contains the latest main couldn't be checked, so it waits",
  review_findings_unknown: "Its review findings couldn't be read, so it waits",
  open_review_findings: "A review agent left open findings on this head: a fix, or Andy's label",
  not_ready_for_review: "Its ticket isn't in Ready for review",
  main_checks_unknown: "Main's checks couldn't be read, so it waits",
};

/** One plain sentence per gate reason, which `gate_not_clean` stands for. */
export const GATE_REASON_TEXT: Record<Exclude<GateReason, "protected_path">, string> = {
  no_verification_output: "The build agent reported no verification output, so the gate vetoes it",
  files_incomplete: "Its changed files couldn't all be listed, so it can't be judged",
  checks_incomplete: "Its checks couldn't all be read",
  no_required_checks: "No required checks ran on it",
  checks_failed:
    "A required check failed (the gate records that one failed, not which: see the PR's checks)",
  checks_pending: "Its checks are still running",
  draft: "It is a draft",
  not_default_branch: "It targets a branch other than main",
  sync_pending: "A sync with main is queued or running for it",
  spike_outside_docs: "A spike's PR changes files outside docs/, so Andy decides",
};

const NOT_AGENT =
  "Not judged here: no build agent task opened it (a session's PR), so the gate doesn't judge it; MCP merge_pr judges it when asked";
const NOT_YET = "The merge gate hasn't judged its latest head yet";
const MERGING = "Clean: the merge gate merges it through the merge queue";

export interface OpenPrsInput {
  /** Every ticket in the project. */
  tickets: readonly Ticket[];
  /** History (oldest first) of the tickets that were read, by ticket id. */
  ticketEvents: ReadonlyMap<string, readonly TicketEvent[]>;
  /** Agent tasks (newest first) of the tickets that were read, by ticket id. */
  ticketRuns: ReadonlyMap<string, readonly Run[]>;
  /** Repos whose merges are held while main is red (AI-382). */
  mergeHolds: readonly MergeHold[];
}

export interface OpenPrs {
  openPrs: DigestOpenPr[];
  truncated: boolean;
}

/**
 * Each PR whose last link event says open, on a ticket that isn't Done, Cancelled or archived,
 * in board order (rank: the order they should merge), up to `DIGEST_OPEN_PRS_MAX`. Only tickets
 * whose history was read count; `truncated` also says when a ticket in review wasn't read.
 */
export function openPrs(input: OpenPrsInput): OpenPrs {
  const found: { ticket: Ticket; number: number; url: string }[] = [];
  let unread = false;
  const open = input.tickets
    .filter((t) => !t.archived && t.stage !== "done" && t.stage !== "cancelled")
    .sort((a, b) => a.rank.localeCompare(b.rank) || a.key.localeCompare(b.key));
  for (const ticket of open) {
    const events = input.ticketEvents.get(ticket.id);
    if (!events) {
      if (ticket.stage === "ready_for_review") unread = true;
      continue;
    }
    const last = new Map<string, { number: number; state: unknown }>();
    for (const e of events) {
      if (e.kind !== "pr_linked") continue;
      const { number, url, state } = e.data;
      if (typeof number !== "number" || typeof url !== "string") continue;
      last.set(url, { number, state });
    }
    for (const [url, pr] of last) {
      if (pr.state === "open") found.push({ ticket, number: pr.number, url });
    }
  }
  return {
    openPrs: found.slice(0, DIGEST_OPEN_PRS_MAX).map((p) => {
      const run = (input.ticketRuns.get(p.ticket.id) ?? []).find(
        (r) => r.links.pullRequest === p.url,
      );
      return openPr(p.ticket, p.number, p.url, run, input.mergeHolds);
    }),
    truncated: unread || found.length > DIGEST_OPEN_PRS_MAX,
  };
}

function openPr(
  ticket: Ticket,
  number: number,
  url: string,
  run: Run | undefined,
  holds: readonly MergeHold[],
): DigestOpenPr {
  const base = { ticketKey: ticket.key, title: ticket.title, prNumber: number, prUrl: url };
  if (!run || run.mergeVerdict === null) {
    return {
      ...base,
      state: "not_judged",
      mergeMode: run?.mergeMode ?? null,
      reasons: [],
      lines: [run ? NOT_YET : NOT_AGENT],
    };
  }
  if (run.mergeVerdict === "merge") {
    return { ...base, state: "merging", mergeMode: run.mergeMode, reasons: [], lines: [MERGING] };
  }
  const repo = pullRequestRef(url)?.repo.toLowerCase();
  const hold = holds.find((h) => h.repo.toLowerCase() === repo);
  const lines = run.verdictReasons.flatMap((r) => reasonLines(r, run, hold));
  return {
    ...base,
    state: "waiting",
    mergeMode: run.mergeMode,
    reasons: run.verdictReasons,
    lines: [...new Set(lines)],
  };
}

function reasonLines(reason: MergeWaitReason, run: Run, hold: MergeHold | undefined): string[] {
  if (reason === "main_red") {
    if (!hold) return ["Held because main was red when the gate last judged it"];
    const failing = hold.checks.length ? hold.checks.join(", ") : "a required check";
    return [`Held because main is red (failing: ${failing}); it merges once main is green`];
  }
  if (reason !== "gate_not_clean" || run.gateReasons.length === 0) {
    return [MERGE_WAIT_TEXT[reason]];
  }
  return run.gateReasons.map((g) =>
    g === "protected_path"
      ? `It changes a protected path, so the gate vetoes it${
          run.protectedFiles.length ? `: ${run.protectedFiles.slice(0, 3).join(", ")}` : ""
        }`
      : GATE_REASON_TEXT[g],
  );
}
