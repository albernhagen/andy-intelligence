import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { milestoneReorder } from "@andy/domain";
import { MILESTONE_STATUS, MilestoneStatusSelect } from "@/components/MilestoneControls";
import { Loading, QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { unwrap, useApi } from "@/lib/api";
import { useReorderMilestones } from "@/lib/queries";
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
 * milestone's status (AI-311), and milestones reorder by dragging their handle or with Move up
 * and Move down (AI-324); both go through the milestone route, so only the owner can and it's
 * logged.
 */
export function RoadmapPage() {
  const { projectId } = useParams({ strict: false });
  const roadmap = useRoadmap(projectId);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Roadmap</h2>
      {roadmap.isPending && <Loading />}
      {showsError(roadmap) && <QueryError error={roadmap.error} />}
      {roadmap.data?.projects.map((p) => (
        <ProjectSection key={p.projectId} roadmap={p} heading={!projectId} />
      ))}
      {roadmap.data && roadmap.data.projects.length === 0 && (
        <p className="text-sm text-muted-foreground">No projects to show.</p>
      )}
      {roadmap.data?.truncated && (
        <p className="text-sm text-muted-foreground">
          Showing the first 50 projects by key. Open one project&apos;s Roadmap to see more.
        </p>
      )}
    </section>
  );
}

function ProjectSection({ roadmap: r, heading }: { roadmap: ProjectRoadmap; heading: boolean }) {
  const byKey = new Map(r.epics.map((e) => [e.key, e]));
  const loose = r.noMilestone.flatMap((k) => byKey.get(k) ?? []);
  return (
    <section aria-label={r.projectName} className="space-y-2">
      {heading && <h3 className="text-sm font-medium">{r.projectName}</h3>}
      {r.milestones.length === 0 && loose.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No milestones or epics yet. To start, ask a Claude session to plan this project or to
          ideate an epic.
        </p>
      )}
      {r.milestones.length > 0 && (
        <MilestoneList milestones={r.milestones} byKey={byKey} projectId={r.projectId} />
      )}
      {loose.length > 0 && (
        <section aria-label="No milestone" className="space-y-2">
          <h4 className="text-sm font-medium">No milestone</h4>
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
          <ul className="divide-y divide-border rounded-md border border-border">
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
      <div className="flex items-start">
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
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 p-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium">{m.name}</span>
          <Badge variant={status.variant}>{status.label}</Badge>
          {!m.done && (
            <span className="min-w-0 flex-1 text-muted-foreground max-sm:basis-full">
              {m.outcome}
            </span>
          )}
          <Progress done={m.progress.done} total={m.progress.total} />
          {!m.done && <CountChips counts={m.counts} />}
        </button>
      </div>
      {open && (
        <div className="space-y-2 px-2 pb-2 pl-8">
          {m.done && <p className="text-sm text-muted-foreground">{m.outcome}</p>}
          <div className="max-w-48">
            <MilestoneStatusSelect projectId={projectId} milestone={m} />
          </div>
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
    <ul className="divide-y divide-border rounded-md border border-border">
      {epics.map((e) => (
        <li
          key={e.key}
          data-epic={e.key}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2 text-sm"
        >
          <Link
            to="/p/$projectId/t/$ticketRef"
            params={{ projectId, ticketRef: e.key }}
            className="min-w-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="text-xs text-muted-foreground tabular-nums">{e.key}</span> {e.title}
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
