import type { Ticket } from "@andy/contracts";
import { startScore } from "@andy/domain";

/** Why refine scored the ticket as it did; plain text, since refine's words are untrusted. */
export function ScoreReasons({ ticket: t }: { ticket: Ticket }) {
  const rows = [
    ["Risk", t.risk, t.riskReason],
    ["Confidence", t.confidence, t.confidenceReason],
  ].filter(([, value]) => value);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Start score" className="space-y-2">
      <h3 className="text-sm font-medium">
        Start score <span className="font-normal text-muted-foreground">{startScore(t)}</span>
      </h3>
      <dl className="space-y-1 text-sm">
        {rows.map(([label, value, reason]) => (
          <div key={label} className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">
              {label}: {value}
            </dt>
            <dd className="min-w-0 break-words">{reason}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
