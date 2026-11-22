import { Link, useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleDashed } from "lucide-react";
import type { Run } from "@andy/contracts";
import { parseWorkView, WORK_VIEW_LABELS, type WorkView } from "@andy/domain";
import { Markers, TYPE_ICONS } from "@/components/board/BoardCard";
import { WorkViewChips } from "@/components/board/WorkViewChips";
import { Loading, QueryError } from "@/components/Status";
import { unwrap, useApi } from "@/lib/api";
import { runLabel } from "@/lib/board";
import { showsError, useLivePoll } from "@/lib/live";
import { isActiveRun } from "@/lib/queries";
import { STAGE_LABELS, typeLabel } from "@/lib/tickets";

const DEFAULT_VIEW: WorkView = "needs-me";

/** `GET /api/work`, polled like the board: 5 s while a listed ticket has a run, else idle pace. */
function useWork(view: WorkView, projectId: string | undefined) {
  const api = useApi();
  return useQuery({
    ...useLivePoll<{ projects: { tickets: { summary: { run: Pick<Run, "status"> | null } }[] }[] }>(
      "live",
      (data) =>
        data.projects.some((p) =>
          p.tickets.some((t) => t.summary.run && isActiveRun(t.summary.run)),
        ),
    ),
    queryKey: ["work", view, projectId ?? null],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/work", {
          params: { query: { view, ...(projectId ? { project: projectId } : {}) } },
        }),
      ),
  });
}

type WorkData = NonNullable<ReturnType<typeof useWork>["data"]>;
type WorkRow = WorkData["projects"][number]["tickets"][number];

/**
 * Work (AI-198, ADR-0108): one fixed view's open tickets, under All projects grouped by project
 * (a heading with its count, as the inbox does). The chip is in the URL (`?view=`), Needs you by
 * default. Rows open the ticket in its project. Read-only: moves happen on the board.
 */
export function WorkPage() {
  const { projectId } = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const view = parseWorkView(search.view) ?? DEFAULT_VIEW;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const work = useWork(view, projectId);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Work</h2>
      {work.isPending && <Loading />}
      {showsError(work) && <QueryError error={work.error} />}
      {work.data && (
        <>
          <WorkViewChips
            view={view}
            counts={work.data.counts}
            total={null}
            onChange={(next) =>
              void navigate({ to: pathname, search: { view: next ?? undefined } })
            }
          />
          {work.data.projects.length === 0 && (
            <p className="text-muted-foreground">Nothing in {WORK_VIEW_LABELS[view]}.</p>
          )}
          {work.data.projects.map((p) => (
            <section key={p.id} aria-label={p.name} className="space-y-2">
              {!projectId && (
                <h3 className="text-sm font-medium">
                  {p.name} <span className="text-muted-foreground tabular-nums">{p.count}</span>
                </h3>
              )}
              {p.tickets.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {p.tickets.map((t) => (
                    <Row key={t.id} ticket={t} projectId={p.id} />
                  ))}
                </ul>
              )}
              {/* Past the 200-ticket cap a project keeps its count, with fewer rows or none. */}
              {p.tickets.length < p.count && (
                <p className="text-sm text-muted-foreground">
                  {p.count - p.tickets.length} more not shown
                </p>
              )}
            </section>
          ))}
          {work.data.truncated && (
            <p className="text-sm text-muted-foreground">
              Showing the first 200 tickets of the first 50 projects by key; chip counts cover those
              projects only. Open one project&apos;s Work to see more.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Row({ ticket: t, projectId }: { ticket: WorkRow; projectId: string }) {
  const Icon = t.type ? TYPE_ICONS[t.type] : CircleDashed;
  const { openQuestions, run, pullRequest, worker } = t.summary;
  return (
    <li data-ticket={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2 text-sm">
      <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
        <span title={typeLabel(t.type)}>
          <Icon className="size-3.5" aria-hidden />
        </span>
        {t.key}
      </span>
      <Link
        to="/p/$projectId/t/$ticketRef"
        params={{ projectId, ticketRef: t.key }}
        className="min-w-0 flex-1 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {t.title}
      </Link>
      <span className="text-xs text-muted-foreground">{STAGE_LABELS[t.stage]}</span>
      <Markers
        ticket={t}
        openQuestions={openQuestions}
        needsAttention={t.needsAttention}
        run={run ? runLabel(run, Date.now()) : null}
        pullRequest={pullRequest}
        blockers={t.blockers.map((key) => ({ key }))}
        archived={t.archived}
        worker={worker}
        stage={t.stage}
        type={t.type}
        sentBack={null}
      />
    </li>
  );
}
