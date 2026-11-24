import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import type { Project, WaitingMerge } from "@andy/contracts";
import { ConfigChanges } from "@/components/ConfigChanges";
import { InboxTicketCard } from "@/components/inbox/InboxTicketCard";
import { MergeDetail, mergeWhy } from "@/components/inbox/MergesWaiting";
import { ProjectPlansWaiting, useWaitingPlans } from "@/components/ProjectPlan";
import { Loading, QueryError } from "@/components/Status";
import { Button } from "@/components/ui/button";
import { inboxCards, type InboxCard } from "@/lib/needs-you";
import { useNeedsYou, useProjects } from "@/lib/queries";
import { showsError } from "@/lib/live";
import { useIsPhone } from "@/lib/use-phone";
import { cn } from "@/lib/utils";

/** One row of the inbox list: a PR waiting for Andy's merge, or a ticket waiting on him. */
type Entry =
  | { kind: "merge"; id: string; group: string; merge: WaitingMerge }
  | { kind: "ticket"; id: string; group: string | null; card: InboxCard; projectName: string };

/** The detail pane's id: list rows point `1`–`9`, `a` and Enter at it (shortcuts.ts). */
const DETAIL_ID = "inbox-detail";

/**
 * Needs-you inbox, the home screen (ARCHITECTURE §7.5; AI-371: list beside detail). The list:
 * PRs waiting for Andy's merge, then one row per ticket with its open questions, most unblocking
 * first (order and counts from `lib/needs-you.ts`), Done, Cancelled and archived tickets last
 * under "Stale"; under `/all/inbox` grouped by project. The picked row's decisions show beside
 * it. On a phone, one decision at a time with its place in the queue.
 */
export function InboxPage() {
  const { projectId } = useParams({ strict: false });
  const needsYou = useNeedsYou();
  const projects = useProjects();
  const plans = useWaitingPlans(projectId);
  const phone = useIsPhone();
  // The picked row, and where it was: when it leaves (answered), the row now there is picked.
  const [picked, setPicked] = useState<{ id: string; index: number } | null>(null);
  if (needsYou.isPending) return <Loading />;
  if (needsYou.data === undefined || showsError(needsYou))
    return (
      <QueryError
        error={needsYou.error}
        what="the Needs-you inbox"
        onRetry={() => void needsYou.refetch()}
      />
    );

  const { active, stale } = inboxCards(needsYou.data, projectId);
  const { waitingMerges } = needsYou.data;
  const merges = waitingMerges.merges.filter((m) => !projectId || m.projectId === projectId);
  const entries = inboxEntries(merges, active, stale, projects.data ?? [], !projectId);
  // Tickets, as the header and picker count them (AI-347); plans and merges have their own headings.
  const total = active.length + stale.length;
  const nothing = total + plans.shown.length + merges.length === 0;
  const found = entries.findIndex((e) => e.id === picked?.id);
  const index = found !== -1 ? found : Math.min(picked?.index ?? 0, entries.length - 1);
  const current = entries[index];
  const pick = (i: number) => setPicked({ id: entries[i]!.id, index: i });

  const heading = (
    <h2 className="text-md font-medium">
      Needs you <span className="text-muted-foreground tabular-nums">{total}</span>
    </h2>
  );

  if (phone)
    return (
      <section className="space-y-4">
        {heading}
        <ProjectPlansWaiting projectId={projectId} />
        {nothing && <p className="text-muted-foreground">Nothing needs you.</p>}
        {current && (
          <PhoneDecision
            entry={current}
            index={index}
            count={entries.length}
            onMove={(delta) => pick(index + delta)}
          />
        )}
        <ConfigChanges projectId={projectId} />
      </section>
    );

  return (
    <section className="grid min-h-[calc(100dvh-2rem)] grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] overflow-hidden rounded-lg border border-border">
      <div className="space-y-4 border-r border-border p-3">
        {heading}
        <ProjectPlansWaiting projectId={projectId} />
        {nothing && <p className="text-muted-foreground">Nothing needs you.</p>}
        {groupsOf(entries).map(({ title, rows }) => (
          <section key={title ?? "tickets"} aria-label={title ?? "Tickets"} className="space-y-1">
            {title && (
              <h3 className="px-2 text-xs font-medium text-muted-foreground">
                {title} <span className="tabular-nums">{rows.length}</span>
              </h3>
            )}
            <ul className="space-y-0.5">
              {rows.map((e) => {
                const i = entries.indexOf(e);
                return (
                  <li key={e.id}>
                    <Row entry={e} picked={i === index} onPick={() => pick(i)} />
                  </li>
                );
              })}
            </ul>
            {title === MERGE_GROUP && waitingMerges.truncated && (
              <p className="px-2 text-xs text-muted-foreground">
                More tickets are in review than one read checks: some PRs may be missing.
              </p>
            )}
          </section>
        ))}
        <ConfigChanges projectId={projectId} />
      </div>
      <div id={DETAIL_ID} data-nav-detail-root className="bg-raised px-6 py-4">
        {current && <Detail entry={current} />}
      </div>
    </section>
  );
}

const MERGE_GROUP = "Waiting for your merge";

/** The list's rows in order: merges, the active tickets (by project under All projects), Stale. */
function inboxEntries(
  merges: WaitingMerge[],
  active: InboxCard[],
  stale: InboxCard[],
  projects: Project[],
  byProject: boolean,
): Entry[] {
  const name = (id: string) => {
    const p = projects.find((x) => x.id === id);
    return p ? `${p.key}: ${p.name}` : id.toUpperCase();
  };
  const ticket = (card: InboxCard, group: string | null): Entry => ({
    kind: "ticket",
    id: card.ticketId,
    group,
    card,
    projectName: projects.find((p) => p.id === card.projectId)?.name ?? card.projectId,
  });
  // Projects in the picker's order (cards keep theirs).
  const order = [...new Set([...projects.map((p) => p.id), ...active.map((c) => c.projectId)])];
  const activeRows = byProject
    ? order.flatMap((id) =>
        active.filter((c) => c.projectId === id).map((c) => ticket(c, name(id))),
      )
    : active.map((c) => ticket(c, null));
  return [
    ...merges.map((m): Entry => ({ kind: "merge", id: m.prUrl, group: MERGE_GROUP, merge: m })),
    ...activeRows,
    ...stale.map((c) => ticket(c, "Stale")),
  ];
}

/** Consecutive rows under one heading. */
function groupsOf(entries: Entry[]) {
  const groups: { title: string | null; rows: Entry[] }[] = [];
  for (const e of entries) {
    const last = groups.at(-1);
    if (last && last.title === e.group) last.rows.push(e);
    else groups.push({ title: e.group, rows: [e] });
  }
  return groups;
}

/** What a row says under its title: the one question, or how many and what kind. */
function summary(entry: Entry): string {
  if (entry.kind === "merge") return `PR #${entry.merge.prNumber} · ${mergeWhy(entry.merge)}`;
  const { questions } = entry.card;
  if (questions.length === 0) return "Flagged for you";
  if (questions.length === 1) return questions[0]!.text;
  const urgent = questions.filter((q) => q.urgency === "high").length;
  const suggested = questions.filter((q) => q.suggestedAnswer).length;
  return [
    `${questions.length} questions`,
    urgent > 0 && `${urgent} urgent`,
    suggested > 0 && `${suggested} with a suggestion`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function entryKey(entry: Entry): string {
  return entry.kind === "merge" ? entry.merge.ticketKey : (entry.card.ticket?.key ?? "");
}

function entryTitle(entry: Entry): string {
  return entry.kind === "merge" ? entry.merge.ticketTitle : (entry.card.ticket?.title ?? "Ticket");
}

/**
 * A list row: a stop for `j` / `k` (AI-338), picked when it takes focus, so the keys walk the
 * list and its decisions show beside it. Its `1`–`9`, `a` and Enter act on the detail.
 */
function Row({ entry, picked, onPick }: { entry: Entry; picked: boolean; onPick: () => void }) {
  const key = entryKey(entry);
  return (
    <button
      type="button"
      aria-label={`${key}: ${entryTitle(entry)}`}
      aria-current={picked ? "true" : undefined}
      data-nav-item
      data-nav-detail={DETAIL_ID}
      onFocus={onPick}
      onClick={onPick}
      className={cn(
        "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-md border-l-2 border-transparent px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
        picked && "border-selected-edge bg-selected hover:bg-selected",
      )}
    >
      <span aria-hidden className="size-1.5 -translate-y-0.5 rounded-full bg-attention" />
      <span className="truncate">{entryTitle(entry)}</span>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">{key}</span>
      <span className="col-start-2 col-end-4 truncate text-xs text-muted-foreground">
        {summary(entry)}
      </span>
    </button>
  );
}

function Detail({ entry, only }: { entry: Entry; only?: boolean }) {
  return entry.kind === "merge" ? (
    <MergeDetail merge={entry.merge} />
  ) : (
    <InboxTicketCard card={entry.card} projectName={entry.projectName} only={only} />
  );
}

/** The phone's one decision (AI-371): its place in the queue, then the first question. */
function PhoneDecision(props: {
  entry: Entry;
  index: number;
  count: number;
  onMove: (delta: 1 | -1) => void;
}) {
  const { entry, index, count, onMove } = props;
  const questions = entry.kind === "ticket" ? entry.card.questions.length : 0;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-raised p-3">
      <div className="space-y-1">
        <div aria-hidden className="flex gap-1">
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={cn("h-1 flex-1 rounded-full", i <= index ? "bg-primary" : "bg-muted")}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          Ticket {index + 1} of {count}
          {questions > 1 && ` · question 1 of ${questions}`}
        </p>
      </div>
      <Detail entry={entry} only />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
