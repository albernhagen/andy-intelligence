import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loading, QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { unwrap, useApi } from "@/lib/api";

/**
 * The four DORA metrics (AI-200: M6.15, ADR-0040) for a project over the last 30 or 90 days, from
 * its production deployment records. Loaded on open and on focus, never polled, like the rest of
 * Dashboards.
 */

type Days = 30 | 90;
const WINDOWS: Days[] = [30, 90];

function useDora(projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["dora", projectId],
    queryFn: async () =>
      unwrap(await api.GET("/api/projects/{projectId}/dora", { params: { path: { projectId } } })),
  });
}

/** Hours as "5.5 h" under two days, else "3.2 d". */
export function duration(hours: number | null): string {
  if (hours === null) return "–";
  return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
}

export function DoraPanel({ projectId }: { projectId: string }) {
  const [days, setDays] = useState<Days>(30);
  const dora = useDora(projectId);

  return (
    <section aria-label="DORA metrics" className="space-y-3 rounded-md border border-border p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">DORA metrics (production)</h3>
        <div role="group" aria-label="DORA window" className="flex gap-1">
          {WINDOWS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={d === days ? "default" : "ghost"}
              aria-pressed={d === days}
              onClick={() => setDays(d)}
            >
              {d} days
            </Button>
          ))}
        </div>
        {dora.data?.partial && <Badge variant="attention">Partial: a read cap was reached</Badge>}
      </header>
      {dora.isPending ? (
        <Loading />
      ) : dora.isError ? (
        <QueryError
          error={dora.error}
          what="the DORA metrics"
          onRetry={() => void dora.refetch()}
        />
      ) : (
        <DoraBody report={dora.data} days={days} />
      )}
    </section>
  );
}

type Report = NonNullable<ReturnType<typeof useDora>["data"]>;

function DoraBody({ report, days }: { report: Report; days: Days }) {
  const window = report.windows.find((w) => w.days === days);
  if (!window || window.metrics.deployments === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No production deployments in the last {days} days. The metrics fill in once deployments are
        recorded.
      </p>
    );
  }
  const m = window.metrics;
  const rate = m.changeFailureRate === null ? "–" : `${Math.round(m.changeFailureRate * 100)}%`;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric
        label="Deploy frequency"
        value={`${m.deployFrequency.perWeek} / week`}
        note={m.deployments === 1 ? "1 deployment" : `${m.deployments} deployments`}
      />
      <Metric
        label="Lead time for changes"
        value={report.leadTimeMeasured ? duration(m.leadTimeHours.median) : "Not measured"}
        note={
          report.leadTimeMeasured
            ? `p90 ${duration(m.leadTimeHours.p90)}`
            : "Deployments don't record commit times yet"
        }
      />
      <Metric
        label="Change failure rate"
        value={rate}
        note={`${m.failedDeployments} of ${m.deployments} rolled back`}
      />
      <Metric
        label="Time to restore"
        value={duration(m.timeToRestoreHours.median)}
        note={
          m.timeToRestoreHours.open > 0
            ? `${m.timeToRestoreHours.open} not restored yet`
            : `p90 ${duration(m.timeToRestoreHours.p90)}`
        }
      />
    </dl>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium">{value}</dd>
      <dd className="text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}
