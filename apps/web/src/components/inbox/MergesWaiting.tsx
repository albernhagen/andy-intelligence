import { Link } from "@tanstack/react-router";
import type { MergeWaitReason, WaitingMerge } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";

/** Why a clean PR is Andy's to merge, in words (ADR-0124). */
export const MERGE_REASON_TEXT: Partial<Record<MergeWaitReason, string>> = {
  mode_not_set: "no merge mode saved",
  mode_manual: "manual mode",
  mode_epic: "epic mode",
  kept_path: "touches a kept path",
  high_risk_path: "touches a high-risk path (low-risk mode)",
  accepted_label: "a review finding you accepted",
};

/** "touches a kept path, manual mode": every reason the PR is Andy's. */
export const mergeWhy = (m: WaitingMerge) =>
  m.reasons.map((r) => MERGE_REASON_TEXT[r] ?? r).join(", ");

/**
 * A clean PR the merge mode leaves for Andy (AI-218), picked in the inbox (AI-371): its ticket,
 * the PR, why it is his and its release note (the PR author's text, shown as text). Merging or
 * closing the PR drops it from the inbox.
 */
export function MergeDetail({ merge: m }: { merge: WaitingMerge }) {
  return (
    <article aria-label={`${m.ticketKey}: ${m.ticketTitle}`} className="space-y-3 text-sm">
      <header className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>Waiting for your merge</span>
        <span className="font-mono text-xs tabular-nums">{m.ticketKey}</span>
        <Link
          to="/p/$projectId/t/$ticketRef"
          params={{ projectId: m.projectId, ticketRef: m.ticketKey }}
          data-nav-open
          className="ml-auto inline-flex items-center text-foreground underline-offset-2 hover:underline max-sm:min-h-11"
        >
          Open ticket
        </Link>
      </header>
      <h3 className="text-lg font-semibold">{m.ticketTitle}</h3>
      <p className="flex flex-wrap items-center gap-2">
        <a
          href={m.prUrl}
          rel="noreferrer"
          className="inline-flex items-center tabular-nums underline underline-offset-2 max-sm:min-h-11"
        >
          PR #{m.prNumber}
        </a>
        <Badge variant="attention">Yours: {mergeWhy(m)}</Badge>
      </p>
      {m.note ? (
        <dl className="grid max-w-2xl grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {m.note.whatChanged && <Line label="What changed">{m.note.whatChanged}</Line>}
          {m.note.howItWorks && <Line label="How it works">{m.note.howItWorks}</Line>}
          {m.note.needsYou && <Line label="Needs you">{m.note.needsYou}</Line>}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">No release note read.</p>
      )}
    </article>
  );
}

function Line({ label, children }: { label: string; children: string }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
