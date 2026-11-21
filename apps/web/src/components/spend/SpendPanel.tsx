import { useQueries } from "@tanstack/react-query";
import type { EffectiveSpendCaps, SpendSoFar } from "@andy/contracts";
import { useProjects } from "@/lib/queries";
import { unwrap, useApi } from "@/lib/api";
import { useLivePoll } from "@/lib/live";
import { usd } from "./SpendCaps";

/**
 * Paid spend on Dashboards (AI-257: M10.9): today and month to date for each project and for all
 * projects, against the caps in force (AI-249's read route over the spend ledger). Unknown spend
 * (ledger unreadable) shows as unknown, never as $0. Read-only: caps are set in project settings.
 * Spend by provider and settled vs reserved need ledger totals that don't exist yet.
 */

/** Projects read on the all-projects view (ADR-0028): one spend read each. */
export const SPEND_PANEL_PROJECTS_MAX = 20;

const WARN_PCT = 80;

export interface SpendRow {
  label: string;
  day: number | null;
  /** Null when the caps couldn't be read either. */
  dayCap: number | null;
  month: number | null;
  monthCap: number | null;
}

export function spendRows(
  views: { key: string; effective: EffectiveSpendCaps | null; spent: SpendSoFar | null }[],
): SpendRow[] {
  const rows: SpendRow[] = views.map((v) => ({
    label: v.key,
    day: v.spent?.project.dayMicroUsd ?? null,
    dayCap: v.effective?.project_daily ?? null,
    month: v.spent?.project.monthMicroUsd ?? null,
    monthCap: v.effective?.project_monthly ?? null,
  }));
  // Every project's view carries the same global totals; any read one will do.
  const first = views.find((v) => v.spent) ?? views.find((v) => v.effective) ?? views[0];
  if (first) {
    rows.push({
      label: "All projects",
      day: first.spent?.global.dayMicroUsd ?? null,
      dayCap: first.effective?.global_daily ?? null,
      month: first.spent?.global.monthMicroUsd ?? null,
      monthCap: first.effective?.global_monthly ?? null,
    });
  }
  return rows;
}

export function SpendUsed({
  used,
  cap,
  label,
}: {
  used: number | null;
  /** Null when the caps couldn't be read. */
  cap: number | null;
  label: string;
}) {
  if (used === null || cap === null) return <span className="text-muted-foreground">unknown</span>;
  const pct = cap === 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.floor((used * 100) / cap));
  const tone = pct >= 100 ? "text-destructive" : pct >= WARN_PCT ? "text-attention" : "";
  return (
    <span className={`tabular-nums ${tone}`} aria-label={`${label}: ${usd(used)} of ${usd(cap)}`}>
      {usd(used)} <span className="text-muted-foreground">of {usd(cap)}</span>
      {cap > 0 && <span className="ml-1 text-xs text-muted-foreground">({pct}%)</span>}
    </span>
  );
}

export function SpendPanel({ projectId }: { projectId?: string }) {
  const api = useApi();
  const poll = useLivePoll("slow");
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const shown = (projectId ? projects.filter((p) => p.id === projectId) : projects).slice(
    0,
    SPEND_PANEL_PROJECTS_MAX,
  );
  const reads = useQueries({
    queries: shown.map((p) => ({
      ...poll,
      // Same key as the settings panel, so the two share one read.
      queryKey: ["spend", p.id],
      queryFn: async () =>
        unwrap(
          await api.GET("/api/projects/{projectId}/spend", {
            params: { path: { projectId: p.id } },
          }),
        ),
    })),
  });
  // A project whose read failed (or is still loading) shows as unknown; the rest still show.
  const loading = projectsQuery.isPending || reads.some((r) => r.isPending);
  const views = shown.map((p, i) => {
    const data = reads[i]?.data;
    return data
      ? { key: p.key, effective: data.effective, spent: data.spent }
      : { key: p.key, effective: null, spent: null };
  });
  const failed = reads.filter((r) => r.isError).length;

  return (
    <section aria-label="Paid spend" className="space-y-2 rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">Paid spend</h3>
      <p className="text-xs text-muted-foreground">
        Pay-per-use models only, in UTC days and months, against the caps in force. Subscription
        usage is in the quota banner.
      </p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">No projects yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-normal">Scope</th>
              <th className="text-left font-normal">Today</th>
              <th className="text-left font-normal">This month</th>
            </tr>
          </thead>
          <tbody>
            {spendRows(views).map((r) => (
              <tr key={r.label} className="h-8">
                <th scope="row" className="text-left font-normal">
                  {r.label}
                </th>
                <td>
                  <SpendUsed used={r.day} cap={r.dayCap} label={`${r.label} today`} />
                </td>
                <td>
                  <SpendUsed used={r.month} cap={r.monthCap} label={`${r.label} this month`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {failed > 0 && (
        <p className="text-xs text-destructive">
          Couldn't read spend for {failed === 1 ? "one project" : `${failed} projects`}; treat it as
          unknown.
        </p>
      )}
      {projects.length > SPEND_PANEL_PROJECTS_MAX && !projectId && (
        <p className="text-xs text-muted-foreground">
          First {SPEND_PANEL_PROJECTS_MAX} projects shown; open a project's Dashboards for the rest.
        </p>
      )}
    </section>
  );
}
