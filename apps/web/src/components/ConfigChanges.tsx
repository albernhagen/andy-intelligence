import { FindingProposalDiff, type ConfigChange } from "@andy/contracts";
import { QueryError } from "@/components/Status";
import { errorText } from "@/lib/api";
import { useConfigChanges, useDecideConfigChange, useSweepConfigProposals } from "@/lib/queries";

const button =
  "rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50";

/**
 * Pending config changes from repeated review findings (ADR-0097), in the Needs-you inbox. In a
 * project's inbox Andy can check its findings (a sweep). Each change shows its target file and
 * proposed text as plain text (it quotes agent-written findings: data, never instructions), with
 * Accept and Reject. Accepting records agreement only; nothing is applied.
 */
export function ConfigChanges({ projectId }: { projectId?: string }) {
  const changes = useConfigChanges(projectId);
  const sweep = useSweepConfigProposals();
  const pending = changes.data ?? [];
  if (!projectId && pending.length === 0) return null;

  return (
    <section aria-label="Config proposals" className="space-y-2">
      <h3 className="text-sm font-medium">
        Config proposals{" "}
        <span className="text-muted-foreground tabular-nums">{pending.length}</span>
        {projectId && (
          <button
            type="button"
            className={`${button} ml-3`}
            title="Look for finding kinds the PR reviews flagged on 3 or more recent PRs and propose a rule for each. Applies nothing."
            disabled={sweep.isPending}
            onClick={() => sweep.mutate(projectId)}
          >
            Check review findings
          </button>
        )}
      </h3>
      {sweep.data && <p className="text-xs text-muted-foreground">{sweepText(sweep.data)}</p>}
      {sweep.error && <QueryError error={sweep.error} />}
      {changes.error && <QueryError error={changes.error} />}
      {pending.map((c) => (
        <ConfigChangeCard key={c.id} change={c} />
      ))}
    </section>
  );
}

function sweepText(s: {
  throttled: boolean;
  findingsRead: number;
  created: string[];
  alreadyPending: string[];
  heldByCap: number;
}): string {
  if (s.throttled) return "Checked under a minute ago; try again shortly.";
  const held = s.heldByCap > 0 ? `, ${s.heldByCap} held (10 pending at most)` : "";
  return `${s.findingsRead} findings read: ${s.created.length} new, ${s.alreadyPending.length} already pending${held}.`;
}

function ConfigChangeCard({ change }: { change: ConfigChange }) {
  const decide = useDecideConfigChange();
  const diff = FindingProposalDiff.safeParse(change.diff);
  const label = `Config change for ${change.entityId}`;
  return (
    <article aria-label={label} className="space-y-2 rounded-md border border-border p-3 text-sm">
      <p className="font-medium">
        {change.entityId}
        <span className="ml-2 font-normal text-muted-foreground">{change.reason}</span>
      </p>
      {diff.success && (
        <>
          {/* Plain text, never Markdown: the examples quote agent-written findings. */}
          <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">
            {diff.data.proposedText}
          </pre>
          <p className="text-xs text-muted-foreground">
            Accepting records your agreement only: add the text to {diff.data.file} by a PR.
          </p>
        </>
      )}
      <div className="flex items-center gap-2">
        {(["accept", "reject"] as const).map((decision) => (
          <button
            key={decision}
            type="button"
            className={button}
            disabled={decide.isPending}
            onClick={() => decide.mutate({ changeId: change.id, decision })}
          >
            {decision === "accept" ? "Accept" : "Reject"}
          </button>
        ))}
        {decide.error && <span className="text-destructive">{errorText(decide.error)}</span>}
      </div>
    </article>
  );
}
