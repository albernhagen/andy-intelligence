import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { WhatsNew, WhatsNewMilestone, WhatsNewNote } from "@andy/contracts";
import { mergedByText } from "@andy/domain";
import { DailySummary } from "@/components/DailySummary";
import { PageHeader } from "@/components/PageHeader";
import { ListSkeleton } from "@/components/PageSkeleton";
import { QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDigest, useWhatsNew } from "@/lib/queries";
import { dateTime } from "@/lib/format";

const WINDOWS = [
  { days: 1, label: "24 hours" },
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
 * Exceptions (waiting for you, blocked) come first, from the digest read MCP `digest` uses: the
 * Digest screen folded in here (AI-341), with a "24 hours" window; `/digest` opens it.
 */
export function WhatsNewPage() {
  const { projectId = "" } = useParams({ strict: false });
  // From the URL, so a link or redirect to `?days=1` changes the window even while the page is open.
  const search = useSearch({ strict: false });
  const days = "days" in search && typeof search.days === "number" ? search.days : 14;
  const navigate = useNavigate();
  const setDays = (next: number) =>
    void navigate({ to: ".", search: next === 14 ? {} : { days: next }, replace: true });
  const [epic, setEpic] = useState<string | null>(null);
  const whatsNew = useWhatsNew(projectId, days, epic);

  return (
    <section>
      <PageHeader
        title="What's new"
        actions={
          whatsNew.data &&
          whatsNew.data.milestones.length > 0 && (
            <Select value={epic ?? ALL} onValueChange={(v) => setEpic(v === ALL ? null : v)}>
              <SelectTrigger aria-label="Epic" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All epics</SelectItem>
                {whatsNew.data.milestones.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.key}: {m.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      >
        <Segmented
          label="Window"
          value={days}
          options={WINDOWS.map((w) => ({ value: w.days, label: w.label }))}
          onChange={setDays}
        />
      </PageHeader>
      <div className="space-y-4">
        <DailySummary projectId={projectId} />
        {/* Waiting and status first in the page order (a phone reads them first); beside the
            changes from lg. */}
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
          <aside className="space-y-3 lg:order-2">
            <Exceptions projectId={projectId} />
            {whatsNew.data && <Status whatsNew={whatsNew.data} projectId={projectId} />}
          </aside>
          <div className="min-w-0 lg:order-1">
            {whatsNew.isPending ? (
              <ListSkeleton />
            ) : whatsNew.isError ? (
              <QueryError
                error={whatsNew.error}
                what="what's new"
                onRetry={() => void whatsNew.refetch()}
              />
            ) : (
              <Changes whatsNew={whatsNew.data} projectId={projectId} days={days} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Radix Select can't hold an empty value, so "every epic" has its own. */
const ALL = "__all__";

function Status({ whatsNew, projectId }: { whatsNew: WhatsNew; projectId: string }) {
  const open = whatsNew.milestones.filter((m) => m.notStarted + m.inProgress + m.inReview > 0);
  const finished = whatsNew.milestones.filter((m) => !open.includes(m));
  const { needsYou } = whatsNew;
  return (
    <section
      aria-label="Status"
      className="space-y-2 rounded-lg border border-border bg-raised p-3"
    >
      <h3 className="text-sm font-semibold">Status</h3>
      {/* AI-218: who merges this project's PRs now (ADR-0124). */}
      <p className="text-sm" aria-label="Merge mode">
        <span className="text-xs text-muted-foreground">Merge mode</span>{" "}
        {whatsNew.mergeMode ?? "not set: nothing merges on its own"}
      </p>
      {open.length === 0 && finished.length === 0 && (
        <p className="text-sm text-muted-foreground">No epics yet.</p>
      )}
      {open.length > 0 && (
        <table className="w-full text-sm">
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
  const total = m.done + m.inReview + m.inProgress + m.notStarted;
  return (
    <tr className="align-top">
      <td className="py-1.5 pr-2">
        <TicketLink projectId={projectId} ticketKey={m.key} title={m.title} />
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span
            role="progressbar"
            aria-label={`${m.done} of ${total} done`}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={m.done}
            className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
          >
            <span
              className="block h-full bg-success"
              style={{ width: `${total ? Math.round((m.done / total) * 100) : 0}%` }}
            />
          </span>
          {m.done} of {total} done · {m.inReview} in review · {m.inProgress} in progress
        </div>
      </td>
      <td className="py-1.5 text-right">
        {m.needsYou > 0 && <Badge variant="attention">{m.needsYou} need you</Badge>}
      </td>
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
        <EmptyState
          title={`Nothing merged in the last ${props.days === 1 ? "24 hours" : `${props.days} days`}.`}
          description={
            props.days < 90 ? "A longer window may show older changes." : "Merged PRs show here."
          }
          action={
            props.days < 90 ? (
              <Button asChild variant="outline" className="h-11 sm:h-9">
                <Link to="." search={{ days: 90 }} replace>
                  Show 90 days
                </Link>
              </Button>
            ) : undefined
          }
        />
      )}
      {[...days].map(([day, list]) => (
        <section key={day} aria-label={day} className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {day} <span className="tabular-nums">{list.length}</span>
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-raised text-sm">
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
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${n.source === "no_note" ? "bg-border" : "bg-success"}`}
          />
          <span className="min-w-0 flex-1 basis-64">
            <span className="block font-medium">{n.whatChanged ?? n.prTitle}</span>
            <span className="block text-xs text-muted-foreground">
              {n.ticketKey && (
                <>
                  <TicketKeyLink projectId={projectId} ticketKey={n.ticketKey} /> ·{" "}
                </>
              )}
              <a href={n.prUrl} rel="noreferrer" className="underline-offset-2 hover:underline">
                PR #{n.prNumber}
              </a>{" "}
              · {mergedByText(n)}
            </span>
          </span>
          {n.source === "no_note" && <Badge>No note</Badge>}
          {n.source === "backfill" && <Badge>Backfilled</Badge>}
          {n.needsYou && <Badge variant="attention">Needs you</Badge>}
        </summary>
        <dl className="mx-3 mb-3 ml-6 grid max-w-2xl grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-l border-border pl-3 text-sm">
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

/**
 * What is waiting right now (AI-341, from the digest, ADR-0081): tickets waiting for Andy or
 * blocked, failed agent tasks and the like, each with its reason. Always the last 24 hours,
 * whatever window the changes show; nothing waiting shows nothing.
 */
function Exceptions({ projectId }: { projectId: string }) {
  const digest = useDigest(projectId, 24);
  if (digest.isError)
    return (
      <QueryError
        error={digest.error}
        what="what's waiting"
        onRetry={() => void digest.refetch()}
      />
    );
  const exceptions = digest.data?.exceptions ?? [];
  if (exceptions.length === 0) return null;
  const allWaiting = exceptions.every((e) => e.kind === "waiting_on_andy");
  return (
    <section
      aria-label="Exceptions"
      className="space-y-2 rounded-lg border border-attention/60 bg-raised p-3"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {allWaiting ? "Waiting for you" : "Exceptions"}
        <Badge variant="attention" className="tabular-nums">
          {exceptions.length}
        </Badge>
      </h3>
      <ul className="space-y-1.5 text-sm">
        {exceptions.map((e, i) => (
          <li key={i}>
            {e.ticketKey ? (
              <TicketLink projectId={projectId} ticketKey={e.ticketKey} title={e.title ?? ""} />
            ) : (
              "Project"
            )}{" "}
            · {/* Waiting on Andy is attention, not an error (design.md colour roles). */}
            <span className={e.kind === "waiting_on_andy" ? "text-attention" : "text-destructive"}>
              {e.reason}
            </span>
          </li>
        ))}
      </ul>
      <Button asChild variant="outline" size="sm" className="h-11 sm:h-8" aria-keyshortcuts="G I">
        <Link to="/p/$projectId/inbox" params={{ projectId }}>
          Open inbox <Kbd>G</Kbd> <Kbd>I</Kbd>
        </Link>
      </Button>
    </section>
  );
}
