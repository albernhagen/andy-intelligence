import { useState, type FormEvent } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronRight, GripVertical } from "lucide-react";
import type { Ticket } from "@andy/contracts";
import { inboxCards, milestoneOf, reorderRank } from "@andy/domain";
import { DRAG_PREVIEW_CLASS } from "@/components/DragPreview";
import { EpicBreakdownPanel, useWaitingBreakdowns } from "@/components/EpicBreakdown";
import { MilestoneCaseView } from "@/components/MilestoneCase";
import { MILESTONE_STATUS } from "@/components/MilestoneControls";
import { NotFound } from "@/components/NotFound";
import { PageHeader } from "@/components/PageHeader";
import { ListSkeleton } from "@/components/PageSkeleton";
import { PanelSelect } from "@/components/PanelSelect";
import {
  CountChips,
  EpicRow,
  EpicSummary,
  Progress,
  StatusPick,
} from "@/components/roadmap/RoadmapParts";
import {
  ReorderControls,
  SortableRows,
  useSortableRow,
  type RowReorder,
} from "@/components/roadmap/SortableRows";
import { QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { showsError } from "@/lib/live";
import {
  EpicAttachError,
  useCreateEpicInMilestone,
  useNeedsYou,
  useRankTicket,
  useSetEpicMilestone,
  useTickets,
} from "@/lib/queries";
import { useRoadmap, type Epic, type Milestone } from "@/lib/roadmap";
import { cn } from "@/lib/utils";

/**
 * A milestone's own page (AI-405), at `/p/<project>/m/<milestone id>`: its name, outcome, status
 * (with the roadmap's status pick), progress, case and effort; every epic in it, Done ones
 * included and child epics nested, reordered and moved to another milestone as the roadmap's
 * writes do; Draft tickets per epic (AI-383); New epic, created straight into it; and what waits
 * on Andy inside it. Read from the roadmap's query, so the roadmap and this page share one cache.
 * An unknown id, or another project's, shows the not-found page.
 */
export function MilestonePage() {
  const { projectId, milestoneId } = useParams({ from: "/p/$projectId/m/$milestoneId" });
  const roadmap = useRoadmap(projectId);
  const r = roadmap.data?.projects[0];
  const m = r?.milestones.find((x) => x.id === milestoneId);

  if (roadmap.isPending) return <ListSkeleton />;
  if (roadmap.error instanceof ApiError && roadmap.error.status === 404) return <NotFound />;
  if (showsError(roadmap) && !r)
    return (
      <QueryError
        error={roadmap.error}
        what="the milestone"
        onRetry={() => void roadmap.refetch()}
      />
    );
  if (!r || !m) return <NotFound />;

  const byKey = new Map(r.epics.map((e) => [e.key, e]));
  const epics = m.epicKeys.flatMap((k) => byKey.get(k) ?? []);
  const status = MILESTONE_STATUS[m.done ? "done" : m.status];
  return (
    <article aria-label={m.name} className="space-y-6" data-milestone-page={m.id}>
      <PageHeader
        breadcrumb={
          <>
            <Link
              to="/p/$projectId/roadmap"
              params={{ projectId }}
              className="hover:text-foreground"
            >
              Roadmap
            </Link>
            <ChevronRight aria-hidden className="size-3.5" />
          </>
        }
        title={m.name}
        actions={m.done && <Badge variant={status.variant}>{status.label}</Badge>}
      />
      <section aria-label="Summary" className="space-y-3">
        <p className="text-sm">{m.outcome}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusPick projectId={projectId} milestone={m} />
          <Progress done={m.progress.done} total={m.progress.total} />
          <CountChips counts={m.counts} />
        </div>
      </section>
      <section aria-labelledby="milestone-case" className="space-y-2">
        <h3 id="milestone-case" className="text-sm font-medium">
          Case and effort
        </h3>
        <MilestoneCaseView projectId={projectId} milestone={m} />
      </section>
      <NeedsYouHere projectId={projectId} milestone={m} />
      <MilestoneEpics projectId={projectId} milestone={m} milestones={r.milestones} epics={epics} />
      {r.truncated && (
        <p className="text-xs text-muted-foreground">
          Some epics may not be shown (over the roadmap&apos;s caps).
        </p>
      )}
    </article>
  );
}

/**
 * What waits on Andy inside this milestone, from the inbox's own reads: tickets with open
 * questions or flagged (a plan waiting for his decision is one), PRs waiting for his merge, and
 * epics' drafted tickets. Each links to its ticket's panel.
 */
function NeedsYouHere({ projectId, milestone: m }: { projectId: string; milestone: Milestone }) {
  const needsYou = useNeedsYou();
  const tickets = useTickets(projectId);
  const breakdowns = useWaitingBreakdowns(projectId);
  if (!needsYou.data || !tickets.data) {
    const error = needsYou.error ?? tickets.error;
    return error ? <QueryError error={error} what="what needs you" /> : null;
  }
  const all = tickets.data;
  const byKey = new Map(all.map((t) => [t.key, t]));
  const byId = new Map(all.map((t) => [t.id, t]));
  const here = (t: Ticket | undefined) => !!t && milestoneOf(t, all) === m.id;
  const items: { key: string; title: string; what: string }[] = [
    ...inboxCards(needsYou.data, projectId)
      .active.filter((c) => here(byId.get(c.ticketId)))
      .map((c) => {
        const t = byId.get(c.ticketId)!;
        const n = c.questions.length;
        return {
          key: t.key,
          title: t.title,
          what: n > 0 ? `${n} ${n === 1 ? "question" : "questions"}` : "Flagged for you",
        };
      }),
    ...needsYou.data.waitingMerges.merges
      .filter((w) => w.projectId === projectId && here(byKey.get(w.ticketKey)))
      .map((w) => ({
        key: w.ticketKey,
        title: w.ticketTitle,
        what: `PR #${w.prNumber} waits for your merge`,
      })),
    ...breakdowns.shown
      .filter((w) => here(byId.get(w.epicId)))
      .map((w) => ({ key: w.epicKey, title: w.epicTitle, what: "Drafted tickets to approve" })),
  ];
  return (
    <section aria-labelledby="milestone-needs-you" className="space-y-2">
      <h3 id="milestone-needs-you" className="text-sm font-medium">
        Needs you
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in this milestone waits on you.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-raised">
          {items.map((i) => (
            <li
              key={`${i.key}:${i.what}`}
              className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <Link
                to="/p/$projectId/t/$ticketRef"
                params={{ projectId, ticketRef: i.key }}
                className="min-w-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {i.key}
                </span>{" "}
                {i.title}
              </Link>
              <Badge variant="attention">{i.what}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The milestone's epics in roadmap order, reordered by drag or Move up and Move down. A move
 * places the epic among this milestone's epics by rank (`reorderRank`, the rule MCP
 * `reorder_ticket` uses), saved through the ticket route; a refusal puts the rows back.
 */
function MilestoneEpics({
  projectId,
  milestone: m,
  milestones,
  epics,
}: {
  projectId: string;
  milestone: Milestone;
  milestones: Milestone[];
  epics: Epic[];
}) {
  const tickets = useTickets(projectId);
  const rank = useRankTicket(projectId);
  const [problem, setProblem] = useState<string | null>(null);
  const byKey = new Map((tickets.data ?? []).map((t) => [t.key, t]));
  return (
    <section aria-labelledby="milestone-epics" className="space-y-2">
      <h3 id="milestone-epics" className="text-sm font-medium">
        Epics
      </h3>
      <NewEpic projectId={projectId} milestone={m} />
      {epics.length === 0 ? (
        <p className="text-sm text-muted-foreground">No epics in this milestone yet.</p>
      ) : (
        <SortableRows
          items={epics}
          idOf={(e) => e.key}
          busy={rank.isPending || !tickets.data}
          onMove={(key, to, shown) => {
            setProblem(null);
            const ticket = byKey.get(key);
            const rest = shown.filter((e) => e.key !== key);
            if (!ticket || !tickets.data || rest.length === 0) return null;
            const anchor =
              to < rest.length ? { above: rest[to]!.key } : { below: rest[rest.length - 1]!.key };
            const placed = reorderRank(ticket, anchor, tickets.data);
            if (typeof placed === "string") {
              setProblem(placed);
              return null;
            }
            return rank.mutateAsync({ ticketId: ticket.id, rank: placed.rank });
          }}
          row={(e, reorder) => (
            <EpicPageRow
              key={e.key}
              projectId={projectId}
              epic={e}
              ticket={byKey.get(e.key)}
              milestone={m}
              milestones={milestones}
              reorder={reorder}
            />
          )}
          preview={(e) => (
            <div
              aria-hidden
              data-drag-overlay
              className={cn(
                "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-raised px-3 py-2 text-sm",
                DRAG_PREVIEW_CLASS,
              )}
            >
              <GripVertical className="size-4 shrink-0 text-muted-foreground" />
              <EpicSummary epic={e} projectId={projectId} />
            </div>
          )}
        />
      )}
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {rank.error && <QueryError error={rank.error} />}
    </section>
  );
}

/**
 * One top-level epic: its order controls, its summary, Move to (every milestone, with its status
 * and outcome), Draft tickets (the epic panel's breakdown, shown on request), then its child
 * epics nested under it.
 */
function EpicPageRow({
  projectId,
  epic: e,
  ticket,
  milestone: m,
  milestones,
  reorder,
}: {
  projectId: string;
  epic: Epic;
  ticket: Ticket | undefined;
  milestone: Milestone;
  milestones: Milestone[];
  reorder: RowReorder;
}) {
  const [drafting, setDrafting] = useState(false);
  const sortable = useSortableRow(e.key, reorder);
  return (
    <li
      ref={sortable.ref}
      style={sortable.style}
      data-epic={e.key}
      data-dragging={sortable.isDragging || undefined}
      className={cn(sortable.isDragging && "bg-muted [&>*]:opacity-0")}
    >
      <div className="flex flex-wrap items-start">
        {reorder && (
          <ReorderControls
            name={`${e.key}: ${e.title}`}
            reorder={reorder}
            handle={sortable.handle}
          />
        )}
        <div className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <EpicSummary epic={e} projectId={projectId} />
        </div>
        {ticket && (
          <div className="flex shrink-0 flex-wrap items-end gap-2 px-3 py-1.5 max-sm:basis-full max-sm:pl-3">
            <MoveToMilestone ticket={ticket} milestone={m} milestones={milestones} />
            {e.state !== "done" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 sm:h-8"
                aria-expanded={drafting}
                onClick={() => setDrafting(!drafting)}
              >
                Draft tickets
              </Button>
            )}
          </div>
        )}
      </div>
      {drafting && ticket && (
        <div className="border-t border-border bg-background/40 p-3">
          <EpicBreakdownPanel ticket={ticket} />
        </div>
      )}
      {e.children.length > 0 && (
        <ul
          aria-label={`Child epics of ${e.key}`}
          className="divide-y divide-border border-t border-border"
        >
          {e.children.map((c) => (
            <EpicRow key={c.key} epic={c} parentKey={e.key} projectId={projectId} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Moves a top-level epic to another milestone (or none), as the epic panel's Milestone pick does. */
function MoveToMilestone({
  ticket,
  milestone: m,
  milestones,
}: {
  ticket: Ticket;
  milestone: Milestone;
  milestones: Milestone[];
}) {
  const set = useSetEpicMilestone({ projectId: ticket.projectId, ticketId: ticket.id });
  return (
    <div className="w-56 max-w-full space-y-1">
      <PanelSelect
        label="Milestone"
        hideLabel
        ariaLabel={`Milestone of ${ticket.key}`}
        value={m.id}
        disabled={set.isPending}
        onValueChange={(v) => {
          if (v !== m.id) set.mutate(v || null);
        }}
        options={[
          ...milestones.map((x) => ({
            value: x.id,
            label: x.name,
            description: `${MILESTONE_STATUS[x.done ? "done" : x.status].label} · ${x.outcome}`,
          })),
          {
            value: "",
            label: "No milestone",
            description: "Listed under No milestone on the roadmap",
          },
        ]}
      />
      {set.error && <QueryError error={set.error} />}
    </div>
  );
}

/** New epic: a title, created as an epic already in this milestone (`useCreateEpicInMilestone`). */
function NewEpic({ projectId, milestone: m }: { projectId: string; milestone: Milestone }) {
  const create = useCreateEpicInMilestone(projectId);
  const [title, setTitle] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || create.isPending) return;
    create.mutate(
      { title: t, milestoneId: m.id },
      {
        onSuccess: () => setTitle(""),
        // The epic exists: a retry would create a second one, so the title clears (AI-405).
        onError: (err) => {
          if (err instanceof EpicAttachError) setTitle("");
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex gap-2">
        <Input
          aria-label={`New epic in ${m.name}`}
          placeholder="New epic title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={create.isPending}
          className="h-11 min-w-0 flex-1 text-base sm:h-8 sm:text-sm"
        />
        <Button type="submit" className="h-11 sm:h-8" disabled={!title.trim() || create.isPending}>
          New epic
        </Button>
      </div>
      {create.error && <QueryError error={create.error} />}
    </form>
  );
}
