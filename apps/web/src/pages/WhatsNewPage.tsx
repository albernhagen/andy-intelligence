import { useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import type { WhatsNew, WhatsNewMilestone, WhatsNewNote } from "@andy/contracts";
import { Loading, QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { useWhatsNew } from "@/lib/queries";
import { dateTime } from "@/lib/format";

const WINDOWS = [
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const LINK_KIND = { feature: "Feature", adr: "ADR", runbook: "Runbook" } as const;

/** A merge's day in Andy's time zone, e.g. "Fri, Nov 20". */
export const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * What's new (AI-159, ADR-0121) under `/p/<project>/whats-new`: status per top-level epic and
 * what needs Andy, then merged changes newest first, grouped by day, one line each. A line opens
 * to "How it works", "Needs you" and doc links. Note text is the PR author's, shown as plain text.
 */
export function WhatsNewPage() {
  const { projectId = "" } = useParams({ strict: false });
  const [days, setDays] = useState(14);
  const [epic, setEpic] = useState<string | null>(null);
  const whatsNew = useWhatsNew(projectId, days, epic);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">What's new</h2>
        <Segmented
          label="Window"
          value={days}
          options={WINDOWS.map((w) => ({ value: w.days, label: w.label }))}
          onChange={setDays}
        />
        {whatsNew.data && whatsNew.data.milestones.length > 0 && (
          <select
            aria-label="Epic"
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            value={epic ?? ""}
            onChange={(e) => setEpic(e.target.value || null)}
          >
            <option value="">All epics</option>
            {whatsNew.data.milestones.map((m) => (
              <option key={m.key} value={m.key}>
                {m.key}: {m.title}
              </option>
            ))}
          </select>
        )}
        {/* AI-335: the digest left the header; AI-341 folds it into this page. */}
        <Link
          to="/p/$projectId/digest"
          params={{ projectId }}
          className="ml-auto text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          Digest
        </Link>
      </header>
      {whatsNew.isPending ? (
        <Loading />
      ) : whatsNew.isError ? (
        <QueryError error={whatsNew.error} />
      ) : (
        <>
          <Status whatsNew={whatsNew.data} projectId={projectId} />
          <Changes whatsNew={whatsNew.data} projectId={projectId} days={days} />
        </>
      )}
    </section>
  );
}

function Status({ whatsNew, projectId }: { whatsNew: WhatsNew; projectId: string }) {
  const open = whatsNew.milestones.filter((m) => m.notStarted + m.inProgress + m.inReview > 0);
  const finished = whatsNew.milestones.filter((m) => !open.includes(m));
  const { needsYou } = whatsNew;
  return (
    <section aria-label="Status" className="space-y-1">
      <h3 className="text-sm font-medium">Status</h3>
      {open.length === 0 && finished.length === 0 && (
        <p className="text-sm text-muted-foreground">No epics yet.</p>
      )}
      {open.length > 0 && (
        <table className="text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="pr-4 font-normal">Epic</th>
              <th className="pr-3 text-right font-normal">Done</th>
              <th className="pr-3 text-right font-normal">In review</th>
              <th className="pr-3 text-right font-normal">In progress</th>
              <th className="pr-3 text-right font-normal">Not started</th>
              <th className="font-normal" />
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {open.map((m) => (
              <MilestoneRow key={m.key} milestone={m} projectId={projectId} />
            ))}
          </tbody>
        </table>
      )}
      {finished.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Done: {finished.map((m) => `${m.key}: ${m.title}`).join(" · ")}
        </p>
      )}
      {needsYou.count > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
          <Badge variant="attention">Needs you {needsYou.count}</Badge>
          {needsYou.tickets.map((t) => (
            <TicketLink key={t.key} projectId={projectId} ticketKey={t.key} title={t.title} />
          ))}
        </div>
      )}
    </section>
  );
}

function MilestoneRow({
  milestone: m,
  projectId,
}: {
  milestone: WhatsNewMilestone;
  projectId: string;
}) {
  return (
    <tr className="h-8">
      <td className="pr-4">
        <TicketLink projectId={projectId} ticketKey={m.key} title={m.title} />
      </td>
      <td className="pr-3 text-right">{m.done}</td>
      <td className="pr-3 text-right">{m.inReview}</td>
      <td className="pr-3 text-right">{m.inProgress}</td>
      <td className="pr-3 text-right">{m.notStarted}</td>
      <td>{m.needsYou > 0 && <Badge variant="attention">{m.needsYou} need you</Badge>}</td>
    </tr>
  );
}

function Changes(props: { whatsNew: WhatsNew; projectId: string; days: number }) {
  const { notes, truncated } = props.whatsNew;
  const days = new Map<string, WhatsNewNote[]>();
  for (const n of notes) days.set(dayOf(n.mergedAt), [...(days.get(dayOf(n.mergedAt)) ?? []), n]);
  return (
    <section aria-label="Changes" className="space-y-4">
      {notes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing merged in the last {props.days} days.
        </p>
      )}
      {[...days].map(([day, list]) => (
        <section key={day} aria-label={day} className="space-y-1">
          <h3 className="text-sm font-medium">
            {day} <span className="text-muted-foreground tabular-nums">{list.length}</span>
          </h3>
          <ul className="space-y-1 text-sm">
            {list.map((n) => (
              <ChangeLine key={n.id} note={n} projectId={props.projectId} />
            ))}
          </ul>
        </section>
      ))}
      {truncated && (
        <p className="text-sm text-muted-foreground">
          The read cap was reached: older changes in this window are missing.
        </p>
      )}
    </section>
  );
}

function ChangeLine({ note: n, projectId }: { note: WhatsNewNote; projectId: string }) {
  return (
    <li>
      <details className="group">
        <summary className="cursor-pointer list-none rounded-md px-1 py-1 hover:bg-muted">
          {n.whatChanged ?? n.prTitle}{" "}
          <span className="text-xs text-muted-foreground">
            {n.ticketKey && (
              <>
                <TicketKeyLink projectId={projectId} ticketKey={n.ticketKey} /> ·{" "}
              </>
            )}
            <a href={n.prUrl} rel="noreferrer" className="underline-offset-2 hover:underline">
              PR #{n.prNumber}
            </a>
          </span>{" "}
          {n.source === "no_note" && <Badge>No note</Badge>}
          {n.source === "backfill" && <Badge>Backfilled</Badge>}
          {n.needsYou && <Badge variant="attention">Needs you</Badge>}
        </summary>
        <dl className="ml-1 mt-1 grid max-w-2xl grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-l border-border pl-3 text-sm">
          {n.howItWorks && <Field label="How it works">{n.howItWorks}</Field>}
          {n.needsYou && <Field label="Needs you">{n.needsYou}</Field>}
          {n.links.length > 0 && (
            <Field label="Docs">
              {n.links.map((l, i) => (
                <span key={l.path}>
                  {i > 0 && " · "}
                  <a href={l.url} rel="noreferrer" className="underline-offset-2 hover:underline">
                    {LINK_KIND[l.kind]}: {l.path.split("/").pop()}
                  </a>
                </span>
              ))}
            </Field>
          )}
          <Field label="Merged">
            {dateTime(n.mergedAt)}
            {n.mergedBy ? ` by ${n.mergedBy}` : ""}
            {n.epicKey ? ` · ${n.epicKey}: ${n.epicTitle}` : ""}
          </Field>
        </dl>
      </details>
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function TicketKeyLink({ projectId, ticketKey }: { projectId: string; ticketKey: string }) {
  return (
    <Link
      to="/p/$projectId/t/$ticketRef"
      params={{ projectId, ticketRef: ticketKey }}
      className="tabular-nums underline-offset-2 hover:underline"
    >
      {ticketKey}
    </Link>
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
