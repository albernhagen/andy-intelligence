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

/**
 * "Waiting for your merge" (AI-218): clean PRs the merge mode leaves for Andy, in the order they
 * should merge, each with why it is his and its release note (the PR author's text, shown as
 * text). Merging or closing a PR drops it. Nothing waiting shows nothing.
 */
export function MergesWaiting({
  merges,
  truncated,
}: {
  merges: WaitingMerge[];
  truncated: boolean;
}) {
  if (merges.length === 0) return null;
  return (
    <section aria-label="Waiting for your merge" className="space-y-2">
      <h3 className="text-sm font-medium">
        Waiting for your merge{" "}
        <span className="text-muted-foreground tabular-nums">{merges.length}</span>
      </h3>
      <ol className="space-y-2">
        {merges.map((m) => (
          <MergeCard key={m.prUrl} merge={m} />
        ))}
      </ol>
      {truncated && (
        <p className="text-xs text-muted-foreground">
          More tickets are in review than one read checks: some PRs may be missing.
        </p>
      )}
    </section>
  );
}

function MergeCard({ merge: m }: { merge: WaitingMerge }) {
  const why = m.reasons.map((r) => MERGE_REASON_TEXT[r] ?? r).join(", ");
  return (
    <li
      aria-label={`${m.ticketKey}: ${m.ticketTitle}`}
      data-nav-group
      className="space-y-1 rounded-md border border-border p-2 text-sm"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Link
          to="/p/$projectId/t/$ticketRef"
          params={{ projectId: m.projectId, ticketRef: m.ticketKey }}
          data-nav-open
          className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline max-sm:min-h-11"
        >
          <span className="text-xs text-muted-foreground tabular-nums">{m.ticketKey}:</span>{" "}
          {m.ticketTitle}
        </Link>
        <a
          href={m.prUrl}
          rel="noreferrer"
          className="inline-flex items-center text-xs tabular-nums underline-offset-2 hover:underline max-sm:min-h-11"
        >
          PR #{m.prNumber}
        </a>
        <Badge variant="attention">Yours: {why}</Badge>
      </header>
      {m.note ? (
        <dl className="grid max-w-2xl grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {m.note.whatChanged && <Line label="What changed">{m.note.whatChanged}</Line>}
          {m.note.howItWorks && <Line label="How it works">{m.note.howItWorks}</Line>}
          {m.note.needsYou && <Line label="Needs you">{m.note.needsYou}</Line>}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">No release note read.</p>
      )}
    </li>
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
