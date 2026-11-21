import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleDashed } from "lucide-react";
import { Confidence, Risk, Size, type ReadyFilters, type ReadyTicket } from "@andy/contracts";
import { TYPE_ICONS } from "@/components/board/BoardCard";
import { Loading, QueryError } from "@/components/Status";
import { Select } from "@/components/ui/input";
import { unwrap, useApi } from "@/lib/api";
import { showsError, useLivePoll } from "@/lib/live";
import { readySearch } from "@/lib/ready";
import { typeLabel } from "@/lib/tickets";

/**
 * Ready (AI-298: Parity: ranked Ready list in the web UI): the project's Ready tickets in board
 * rank order with their scores and reasons, the same read as MCP `list_ready`. Filters live in
 * the URL (`?size=S&risk=low`). One project only, like `list_ready` and the board's Ready lane.
 */

function useReady(projectId: string, filters: ReadyFilters) {
  const api = useApi();
  return useQuery({
    // Tickets poll at the live pace; a web write refetches it at once (useWrite invalidates all).
    ...useLivePoll("live"),
    queryKey: ["ready", projectId, filters],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/ready", {
          params: { path: { projectId }, query: filters },
        }),
      ),
  });
}

const FILTERS = [
  { key: "size", label: "Size", options: Size.options },
  { key: "risk", label: "Risk", options: Risk.options },
  { key: "confidence", label: "Confidence", options: Confidence.options },
] as const;

export function ReadyPage() {
  const { projectId = "" } = useParams({ strict: false });
  const filters = readySearch(useSearch({ strict: false }));
  const navigate = useNavigate();
  const ready = useReady(projectId, filters);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">
        Ready{" "}
        {ready.data && (
          <span className="text-muted-foreground tabular-nums">{ready.data.total}</span>
        )}
      </h2>
      <p className="text-sm text-muted-foreground">
        In board order: the order is the priority. A ticket without the score a filter asks for
        isn&apos;t listed.
      </p>
      <div className="flex flex-wrap gap-4">
        {FILTERS.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-sm">
            {f.label}
            <Select
              aria-label={f.label}
              className="h-11 w-auto text-base sm:h-8 sm:text-sm"
              value={filters[f.key] ?? ""}
              onChange={(e) =>
                void navigate({
                  to: ".",
                  search: { ...filters, [f.key]: e.target.value || undefined },
                })
              }
            >
              <option value="">Any</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      {ready.isPending && <Loading />}
      {showsError(ready) && <QueryError error={ready.error} />}
      {ready.data && ready.data.tickets.length === 0 && (
        <p className="text-muted-foreground">No Ready ticket matches.</p>
      )}
      {ready.data && ready.data.tickets.length > 0 && (
        <ol
          aria-label="Ready tickets"
          className="divide-y divide-border rounded-md border border-border"
        >
          {ready.data.tickets.map((t, i) => (
            <Row key={t.key} ticket={t} place={i + 1} projectId={projectId} />
          ))}
        </ol>
      )}
      {ready.data && ready.data.tickets.length < ready.data.total && (
        <p className="text-sm text-muted-foreground">
          {ready.data.total - ready.data.tickets.length} more not shown
        </p>
      )}
    </section>
  );
}

function Row({
  ticket: t,
  place,
  projectId,
}: {
  ticket: ReadyTicket;
  place: number;
  projectId: string;
}) {
  const Icon = t.type ? TYPE_ICONS[t.type] : CircleDashed;
  const reasons = [
    t.sizeReason && `Size: ${t.sizeReason}`,
    t.riskReason && `Risk: ${t.riskReason}`,
    t.confidenceReason && `Confidence: ${t.confidenceReason}`,
  ].filter(Boolean);
  return (
    <li data-ticket={t.key} className="space-y-1 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-6 text-xs text-muted-foreground tabular-nums">{place}</span>
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
        <span className="text-xs text-muted-foreground">{t.score || "No scores"}</span>
      </div>
      {reasons.length > 0 && (
        <ul aria-label="Reasons" className="pl-9 text-xs text-muted-foreground">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
