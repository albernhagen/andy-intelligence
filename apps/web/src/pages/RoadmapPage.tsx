import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { MilestoneStatus } from "@andy/contracts";
import { milestoneReorder } from "@andy/domain";
import { MilestoneCaseView } from "@/components/MilestoneCase";
import { MILESTONE_STATUS } from "@/components/MilestoneControls";
import { PageHeader } from "@/components/PageHeader";
import { ProjectMark } from "@/components/ProjectMark";
import { ListSkeleton } from "@/components/PageSkeleton";
import { QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { unwrap, useApi } from "@/lib/api";
import { useProjects, useReorderMilestones, useSetMilestoneStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { components } from "@/lib/api.gen";
import { showsError, useLivePoll } from "@/lib/live";

type Schema = components["schemas"]["ProjectRoadmap"];
/** An epic as the page shows it: child epics aren't listed, so `children` isn't read. */
type Epic = Omit<Schema["epics"][number], "children">;
type ProjectRoadmap = Omit<Schema, "epics"> & { epics: Epic[] };
type Milestone = Schema["milestones"][number];
type Counts = Milestone["counts"];

/**
 * `GET /api/projects/{id}/roadmap`, or `GET /api/roadmap` under All projects (AI-193, AI-305):
 * polled at the slow pace, as the roadmap moves only when tickets do (ADR-0091).
 */
function useRoadmap(projectId: string | undefined) {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    queryKey: ["roadmap", projectId ?? null],
    queryFn: async () =>
      projectId
        ? {
            projects: [
              unwrap(
                await api.GET("/api/projects/{projectId}/roadmap", {
                  params: { path: { projectId } },
                }),
              ),
            ],
            truncated: false,
          }
        : unwrap(await api.GET("/api/roadmap")),
  });
}

/**
 * Roadmap (AI-202: M4.26, ADR-0131): a project's milestones in order, each with its status and
 * progress, expanding in place to its epics; parked ones dimmed, done ones compact, epics with
 * no milestone last. Under All projects, one section per project. An open row sets the
 * milestone's status (AI-311) beside its case and effort (ADR-0149: a not-reviewed one always,
 * saying so when it has no case), and milestones reorder by dragging their handle or with Move up
 * and Move down (AI-324); both go through the milestone route, so only the owner can and it's
 * logged.
 */
export function RoadmapPage() {
  const { projectId } = useParams({ strict: false });
  const roadmap = useRoadmap(projectId);
  const [show, setShow] = useState<Show>("all");

  return (
    <section>
      <PageHeader
        title="Roadmap"
        actions={
          <Segmented label="Show milestones" value={show} options={SHOW} onChange={setShow} />
        }
      />
      <div className="space-y-6">
        {roadmap.isPending && <ListSkeleton />}
        {showsError(roadmap) && (
          <QueryError
            error={roadmap.error}
            what="the roadmap"
            onRetry={() => void roadmap.refetch()}
          />
        )}
        {roadmap.data?.projects.map((p) => (
          <ProjectSection key={p.projectId} roadmap={p} heading={!projectId} show={show} />
        ))}
        {roadmap.data && roadmap.data.projects.length === 0 && (
          <EmptyState
            title="No projects to show."
            description="A project's milestones and epics show here once it has some."
            action={
              <Button asChild className="h-11 sm:h-9">
                <Link to="/projects/new">Add project</Link>
              </Button>
            }
          />
        )}
        {roadmap.data?.truncated && (
          <p className="text-sm text-muted-foreground">
            Showing the first 50 projects by key. Open one project&apos;s Roadmap to see more.
          </p>
        )}
      </div>
    </section>
  );
}

type Show = "all" | "open" | "parked" | "done";
const SHOW: { value: Show; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "parked", label: "Parked" },
  { value: "done", label: "Done" },
];

/** Open: not done and not parked (approved or waiting for review). */
function shows(m: Milestone, show: Show): boolean {
  if (show === "all") return true;
  if (show === "done") return m.done;
  if (show === "parked") return !m.done && m.status === "parked";
  return !m.done && m.status !== "parked";
}

function ProjectSection({
  roadmap: r,
  heading,
  show,
}: {
  roadmap: ProjectRoadmap;
  heading: boolean;
  show: Show;
}) {
  const byKey = new Map(r.epics.map((e) => [e.key, e]));
  const loose = r.noMilestone.flatMap((k) => byKey.get(k) ?? []);
  const milestones = r.milestones.filter((m) => shows(m, show));
  const logoUpdatedAt = useProjects().data?.find((p) => p.id === r.projectId)?.logoUpdatedAt;
  return (
    <section aria-label={r.projectName} className="space-y-2">
      {heading && (
        <h3 className="flex items-center gap-2 text-md font-semibold">
          <ProjectMark
            project={{
              id: r.projectId,
              key: r.projectKey,
              logoUpdatedAt: logoUpdatedAt ?? null,
            }}
          />
          {r.projectName}
        </h3>
      )}
      {r.milestones.length === 0 && loose.length === 0 && (
        <EmptyState
          className="items-start text-left sm:flex-row sm:items-center sm:justify-between"
          title="No milestones yet"
          description="A plan turns this project's brief into milestones and epics for you to approve."
          action={<StartPlan projectId={r.projectId} />}
        />
      )}
      {milestones.length > 0 && (
        <MilestoneList milestones={milestones} byKey={byKey} projectId={r.projectId} />
      )}
      {r.milestones.length > 0 && milestones.length === 0 && (
        <p className="text-sm text-muted-foreground">No {show} milestones.</p>
      )}
      {loose.length > 0 && show === "all" && (
        <section aria-label="No milestone" className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">No milestone</h4>
          <EpicList epics={loose} projectId={r.projectId} />
        </section>
      )}
      {r.truncated && (
        <p className="text-xs text-muted-foreground">
          Some epics or milestones are not shown (over the roadmap&apos;s caps).
        </p>
      )}
    </section>
  );
}

/**
 * The empty roadmap's one next step: a plan-project agent task (AI-320's route, as MCP
 * `start_plan_project`). Owner only; the API's refusal shows here.
 */
function StartPlan({ projectId }: { projectId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/projects/{projectId}/plan/agent-task", {
          params: { path: { projectId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  if (start.data)
    return (
      <p className="text-sm">
        <Link
          to="/p/$projectId/runs/$runId"
          params={{ projectId, runId: start.data.id }}
          className="underline underline-offset-2"
        >
          Agent task · plan-project
        </Link>{" "}
        started. Its plan waits in your inbox.
      </p>
    );
  return (
    <div className="space-y-1">
      <Button className="h-11 sm:h-9" disabled={start.isPending} onClick={() => start.mutate()}>
        Plan this project
      </Button>
      {start.error && <QueryError error={start.error} />}
    </div>
  );
}

/**
 * The milestone rows, reorderable (AI-324): drag a row's handle (pointer, or Space and the arrow
 * keys), or use Move up and Move down. The new order shows at once and saves through the
 * milestone route; on a refusal the rows go back and the API's message shows.
 */
function MilestoneList({
  milestones,
  byKey,
  projectId,
}: {
  milestones: Milestone[];
  byKey: ReadonlyMap<string, Epic>;
  projectId: string;
}) {
  const reorder = useReorderMilestones(projectId);
  const [pending, setPending] = useState<string[] | null>(null);
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const shown = pending ? pending.flatMap((id) => byId.get(id) ?? []) : milestones;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const canMove = milestones.length > 1;

  function move(id: string, to: number) {
    const writes = milestoneReorder(shown, id, to);
    if (writes.length === 0) return;
    const ids = shown.map((m) => m.id).filter((x) => x !== id);
    ids.splice(to, 0, id);
    setPending(ids);
    // The hook refetches before the mutation settles, so the rows never flash the old order.
    reorder.mutate(writes, { onSettled: () => setPending(null) });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    move(
      String(active.id),
      shown.findIndex((m) => m.id === over.id),
    );
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown.map((m) => m.id)} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-raised">
            {shown.map((m, i) => (
              <MilestoneRow
                key={m.id}
                milestone={m}
                epics={m.epicKeys.flatMap((k) => byKey.get(k) ?? [])}
                projectId={projectId}
                reorder={
                  canMove
                    ? {
                        up: i > 0 ? () => move(m.id, i - 1) : null,
                        down: i < shown.length - 1 ? () => move(m.id, i + 1) : null,
                        busy: reorder.isPending,
                      }
                    : null
                }
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {reorder.error && <QueryError error={reorder.error} />}
    </div>
  );
}

const MOVE_BUTTON =
  "inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 sm:size-7";

function MilestoneRow({
  milestone: m,
  epics,
  projectId,
  reorder,
}: {
  milestone: Milestone;
  epics: Epic[];
  projectId: string;
  /** Null when there is only one milestone, so nothing to reorder. */
  reorder: { up: (() => void) | null; down: (() => void) | null; busy: boolean } | null;
}) {
  const [open, setOpen] = useState(false);
  const status = MILESTONE_STATUS[m.done ? "done" : m.status];
  const Chevron = open ? ChevronDown : ChevronRight;
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition } =
    useSortable({ id: m.id, disabled: !reorder || reorder.busy });
  const style = {
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-milestone={m.id}
      data-status={m.done ? "done" : m.status}
      className={m.status === "parked" ? "opacity-60" : undefined}
    >
      <div className="flex flex-wrap items-start">
        {reorder && (
          <div
            role="group"
            aria-label={`Order of ${m.name}`}
            className="flex items-center pl-1 pt-0.5"
          >
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Drag ${m.name} to reorder`}
              // On a phone the move buttons reorder; the handle would crowd the row.
              className={`${MOVE_BUTTON} cursor-grab max-sm:hidden`}
            >
              <GripVertical className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Move ${m.name} up`}
              disabled={!reorder.up || reorder.busy}
              onClick={() => reorder.up?.()}
              className={MOVE_BUTTON}
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Move ${m.name} down`}
              disabled={!reorder.down || reorder.busy}
              onClick={() => reorder.down?.()}
              className={MOVE_BUTTON}
            >
              <ArrowDown className="size-4" aria-hidden />
            </button>
          </div>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 basis-48">
            <span className="block font-medium">{m.name}</span>
            {!m.done && <span className="block text-muted-foreground">{m.outcome}</span>}
          </span>
          {m.done && <Badge variant={status.variant}>{status.label}</Badge>}
          <Progress done={m.progress.done} total={m.progress.total} />
          {!m.done && <CountChips counts={m.counts} />}
        </button>
        {!m.done && (
          <div className="shrink-0 py-1.5 pr-2 max-sm:basis-full max-sm:pb-2 max-sm:pl-9">
            <StatusPick projectId={projectId} milestone={m} />
          </div>
        )}
      </div>
      {open && (
        <div className="space-y-2 border-t border-border bg-background/40 px-3 pt-2 pb-3 pl-10">
          {m.done && <p className="text-sm text-muted-foreground">{m.outcome}</p>}
          {/* A done milestone keeps its status pick, out of the way in the open row. */}
          {m.done && <StatusPick projectId={projectId} milestone={m} />}
          {/* ADR-0149: the case where Andy decides; once reviewed, only one that was written. */}
          {(m.status === "not_reviewed" || m.case) && (
            <MilestoneCaseView projectId={projectId} milestone={m} />
          )}
          {epics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No epics in this milestone yet.</p>
          ) : (
            <EpicList epics={epics} projectId={projectId} />
          )}
        </div>
      )}
    </li>
  );
}

const EPIC_STATE: Record<Epic["state"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};

function EpicList({ epics, projectId }: { epics: Epic[]; projectId: string }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-raised">
      {epics.map((e) => (
        <li
          key={e.key}
          data-epic={e.key}
          className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
        >
          <Link
            to="/p/$projectId/t/$ticketRef"
            params={{ projectId, ticketRef: e.key }}
            className="min-w-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{e.key}</span>{" "}
            {e.title}
          </Link>
          <span className="text-xs text-muted-foreground">{EPIC_STATE[e.state]}</span>
          {e.outcome && (
            <span className="min-w-0 flex-1 text-xs text-muted-foreground max-sm:basis-full">
              {e.outcome}
            </span>
          )}
          <Progress done={e.progress.done} total={e.progress.total} />
          {e.state !== "done" && <CountChips counts={e.counts} />}
        </li>
      ))}
    </ul>
  );
}

/** "14 of 23 done", with a thin bar beside it (the number is what to read). */
function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span
        role="progressbar"
        aria-label={`${done} of ${total} done`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1 w-16 overflow-hidden rounded-full bg-muted"
      >
        <span className="block h-full bg-success" style={{ width: `${pct}%` }} />
      </span>
      {done} of {total} done
    </span>
  );
}

/** A chip per non-zero count of open tickets: "2 need you", "3 in review", "1 blocked". */
function CountChips({ counts }: { counts: Counts }) {
  const chips: [number, string, "attention" | "running" | "danger" | "default"][] = [
    [counts.needsYou, counts.needsYou === 1 ? "needs you" : "need you", "attention"],
    [counts.inReview, "in review", "default"],
    [counts.inProgress, "in progress", "running"],
    [counts.blocked, "blocked", "danger"],
  ];
  return (
    <span className="flex flex-wrap gap-1">
      {chips
        .filter(([n]) => n > 0)
        .map(([n, label, variant]) => (
          <Badge key={label} variant={variant} className="tabular-nums">
            {n} {label}
          </Badge>
        ))}
    </span>
  );
}

/**
 * The owner's status pick for one milestone, in its row (AI-378; the mockup's Approved | Parked):
 * saved on click, the API's refusal shown. Every write goes through the milestone route (AI-304).
 */
function StatusPick({
  projectId,
  milestone: m,
}: {
  projectId: string;
  milestone: Pick<Milestone, "id" | "name" | "status">;
}) {
  const set = useSetMilestoneStatus(projectId);
  return (
    <div className={cn("space-y-1", set.isPending && "opacity-60")}>
      <Segmented
        label={`Status of ${m.name}`}
        value={m.status}
        options={MilestoneStatus.options.map((s) => ({
          value: s,
          label: MILESTONE_STATUS[s].label,
        }))}
        onChange={(status) => {
          if (status !== m.status && !set.isPending) set.mutate({ milestoneId: m.id, status });
        }}
      />
      {set.error && <QueryError error={set.error} />}
    </div>
  );
}
