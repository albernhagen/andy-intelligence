import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { milestoneReorder } from "@andy/domain";
import { DRAG_PREVIEW_CLASS } from "@/components/DragPreview";
import { MilestoneCaseView } from "@/components/MilestoneCase";
import { MilestonePageLink } from "@/components/MilestoneControls";
import { PageHeader } from "@/components/PageHeader";
import { ProjectMark } from "@/components/ProjectMark";
import { ListSkeleton } from "@/components/PageSkeleton";
import { EpicList, MilestoneSummary, StatusPick } from "@/components/roadmap/RoadmapParts";
import {
  ReorderControls,
  SortableRows,
  useSortableRow,
  type RowReorder,
} from "@/components/roadmap/SortableRows";
import { QueryError } from "@/components/Status";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { unwrap, useApi } from "@/lib/api";
import { useProjects, useReorderMilestones } from "@/lib/queries";
import { useRoadmap, type Epic, type Milestone, type ProjectRoadmap } from "@/lib/roadmap";
import { cn } from "@/lib/utils";
import { showsError } from "@/lib/live";

/**
 * Roadmap (AI-202: M4.26, ADR-0131): a project's milestones in order, each with its status and
 * progress, expanding in place to its epics; parked ones dimmed, done ones compact, epics with
 * no milestone last. Under All projects, one section per project. An open row sets the
 * milestone's status (AI-311) beside its case and effort (ADR-0149: a not-reviewed one always,
 * saying so when it has no case), and milestones reorder by dragging their handle or with Move up
 * and Move down (AI-324); both go through the milestone route, so only the owner can and it's
 * logged. Every epic is listed (AI-403: the board shows epics only as group headers): Done ones,
 * ones with no tickets yet, child epics under their parent, and epics with no milestone in their
 * own group; each links to its panel. Each milestone row links to its own page (AI-405).
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
 * The milestone rows, reorderable (AI-324) through `SortableRows`. Each order write goes through
 * the milestone route; on a refusal the rows go back and the API's message shows.
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
  return (
    <div className="space-y-2">
      <SortableRows
        items={milestones}
        idOf={(m) => m.id}
        busy={reorder.isPending}
        onMove={(id, to, shown) => {
          const writes = milestoneReorder(shown, id, to);
          return writes.length === 0 ? null : reorder.mutateAsync(writes);
        }}
        row={(m, rowReorder) => (
          <MilestoneRow
            key={m.id}
            milestone={m}
            epics={m.epicKeys.flatMap((k) => byKey.get(k) ?? [])}
            projectId={projectId}
            reorder={rowReorder}
          />
        )}
        preview={(m) => (
          <div
            aria-hidden
            data-drag-overlay
            className={cn(
              "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-raised px-3 py-2 text-sm",
              DRAG_PREVIEW_CLASS,
            )}
          >
            <GripVertical className="size-4 shrink-0 text-muted-foreground" />
            <MilestoneSummary milestone={m} />
          </div>
        )}
      />
      {reorder.error && <QueryError error={reorder.error} />}
    </div>
  );
}

function MilestoneRow({
  milestone: m,
  epics,
  projectId,
  reorder,
}: {
  milestone: Milestone;
  epics: Epic[];
  projectId: string;
  reorder: RowReorder;
}) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const sortable = useSortableRow(m.id, reorder);
  return (
    <li
      ref={sortable.ref}
      style={sortable.style}
      data-milestone={m.id}
      data-status={m.done ? "done" : m.status}
      data-dragging={sortable.isDragging || undefined}
      // While dragged, the row stays as a sunken placeholder of its size, its content hidden but
      // still read out; the copy under the pointer is the list's DragPreview.
      className={cn(
        m.status === "parked" && "opacity-60",
        sortable.isDragging && "bg-muted [&>*]:opacity-0",
      )}
    >
      <div className="flex flex-wrap items-start">
        {reorder && <ReorderControls name={m.name} reorder={reorder} handle={sortable.handle} />}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <MilestoneSummary milestone={m} />
        </button>
        {/* AI-405: the milestone's own page, beside the row's expand toggle. */}
        <MilestonePageLink projectId={projectId} milestone={m} className="mt-0.5 sm:mt-2" />
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
