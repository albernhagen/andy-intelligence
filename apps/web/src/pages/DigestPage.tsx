import { useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import type { Digest } from "@andy/contracts";
import { Loading, QueryError } from "@/components/Status";
import { Button } from "@/components/ui/button";
import { useDigest } from "@/lib/queries";

const WINDOWS = [
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
];

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * The daily digest (AI-70, ADR-0081) under `/p/<project>/digest`: exceptions first, then what
 * merged and what it cost, then what is in progress, then totals. The MCP `digest` tool returns
 * the same structure.
 */
export function DigestPage() {
  const { projectId = "" } = useParams({ strict: false });
  const [hours, setHours] = useState(24);
  const digest = useDigest(projectId, hours);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">Digest</h2>
        <div role="group" aria-label="Window" className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w.hours}
              size="sm"
              variant={w.hours === hours ? "default" : "ghost"}
              aria-pressed={w.hours === hours}
              onClick={() => setHours(w.hours)}
            >
              {w.label}
            </Button>
          ))}
        </div>
      </header>
      {digest.isPending ? (
        <Loading />
      ) : digest.isError ? (
        <QueryError error={digest.error} />
      ) : (
        <DigestBody digest={digest.data} projectId={projectId} />
      )}
    </section>
  );
}

function DigestBody({ digest, projectId }: { digest: Digest; projectId: string }) {
  if (digest.quiet) return <p className="text-muted-foreground">{digest.text}</p>;
  const ticket = (key: string | null, title: string | null) =>
    key ? <TicketLink projectId={projectId} ticketKey={key} title={title ?? ""} /> : "Project";
  const { inFlight, readyForReview } = digest.inProgress;
  const t = digest.totals;

  return (
    <>
      <Section title="Exceptions" count={digest.exceptions.length}>
        {digest.exceptions.map((e, i) => (
          <li key={i}>
            {ticket(e.ticketKey, e.title)} · <span className="text-destructive">{e.reason}</span>
          </li>
        ))}
      </Section>
      <Section title="Merged" count={digest.merged.length}>
        {digest.merged.map((m) => (
          <li key={m.prNumber}>
            {ticket(m.ticketKey, m.title)} ·{" "}
            <a href={m.prUrl} className="underline-offset-2 hover:underline">
              PR #{m.prNumber}
            </a>{" "}
            · {m.mergedBy === "gate" ? "auto-merged" : "merged by Andy"} ·{" "}
            {m.gate.wouldAutoMerge === null
              ? "gate not run"
              : m.gate.wouldAutoMerge
                ? "gate passed"
                : `gate held${m.gate.reasons.length ? ` (${m.gate.reasons.join(", ")})` : ""}`}{" "}
            · <span className="tabular-nums">{usd(m.costUsd)}</span>
          </li>
        ))}
      </Section>
      <Section title="In progress" count={inFlight.length + readyForReview.length}>
        {inFlight.map((r, i) => (
          <li key={`run-${i}`}>
            In flight: {ticket(r.ticketKey, r.title)} · {r.label}
          </li>
        ))}
        {readyForReview.map((r) => (
          <li key={r.ticketKey}>
            Ready for review: {ticket(r.ticketKey, r.title)}
            {r.prNumber ? ` · PR #${r.prNumber}` : ""}
          </li>
        ))}
      </Section>
      <section aria-label="Totals" className="space-y-1">
        <h3 className="text-sm font-medium">Totals</h3>
        <p className="text-sm tabular-nums">
          {t.runs} runs{t.failedRuns ? ` (${t.failedRuns} failed)` : ""} · {usd(t.costUsd)}{" "}
          estimated{t.unknownCostRuns ? ` (${t.unknownCostRuns} unknown)` : ""} · {t.merged} merged
        </p>
      </section>
      {digest.truncated && (
        <p className="text-sm text-muted-foreground">
          More tickets changed than one digest reads: some may be missing.
        </p>
      )}
    </>
  );
}

function Section(props: { title: string; count: number; children: ReactNode }) {
  if (props.count === 0) return null;
  return (
    <section aria-label={props.title} className="space-y-1">
      <h3 className="text-sm font-medium">
        {props.title} <span className="text-muted-foreground tabular-nums">{props.count}</span>
      </h3>
      <ul className="space-y-1 text-sm">{props.children}</ul>
    </section>
  );
}

function TicketLink(props: { projectId: string; ticketKey: string; title: string }) {
  return (
    <Link
      to="/p/$projectId/t/$ticketRef"
      params={{ projectId: props.projectId, ticketRef: props.ticketKey }}
      className="underline-offset-2 hover:underline"
    >
      <span className="text-xs text-muted-foreground tabular-nums">{props.ticketKey}:</span>{" "}
      {props.title}
    </Link>
  );
}
