import { useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type {
  Dashboard,
  DashboardCost,
  DashboardFigure,
  DashboardRun,
  DashboardWeek,
  ProjectDashboard,
  Stage,
} from "@andy/contracts";
import { Loading, QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  chartColor,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { unwrap, useApi } from "@/lib/api";

/**
 * Dashboards (AI-117, ADR-0045) under `/p/<project>/dashboards` and `/all/dashboards`: delivery
 * and cost per UTC week over the M4.8 read (AI-102). Loaded on open and on focus, never polled:
 * the all-projects read is expensive. A figure a read cap cut short says so.
 */

const WINDOWS = [4, 8, 12, 26];
const DEFAULT_WEEKS = 8;

/** Series colours come from the tokens, in this order (design.md: never a raw colour). */
const PALETTE = [
  "var(--running)",
  "var(--success)",
  "var(--attention)",
  "var(--primary)",
  "var(--muted-foreground)",
  "var(--destructive)",
  "var(--border)",
];

const STAGES: { stage: Stage; label: string; color: string }[] = [
  { stage: "backlog", label: "Backlog", color: "var(--muted-foreground)" },
  { stage: "ready", label: "Ready", color: "var(--primary)" },
  { stage: "in_progress", label: "In progress", color: "var(--running)" },
  { stage: "ready_for_review", label: "Ready for review", color: "var(--attention)" },
  { stage: "done", label: "Done", color: "var(--success)" },
  { stage: "cancelled", label: "Cancelled", color: "var(--border)" },
];

/** Before the first measure; the container resizes to its width once laid out. */
const INITIAL_SIZE = { width: 640, height: 192 };

const usd = (n: number) => `$${n.toFixed(2)}`;
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const weekLabel = (start: string) =>
  new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function useDashboard(projectId: string | undefined, weeks: number) {
  const api = useApi();
  return useQuery({
    queryKey: ["dashboard", projectId ?? "all", weeks],
    queryFn: async (): Promise<ProjectDashboard | Dashboard> =>
      projectId
        ? unwrap(
            await api.GET("/api/projects/{projectId}/dashboard", {
              params: { path: { projectId }, query: { weeks } },
            }),
          )
        : unwrap(await api.GET("/api/dashboard", { params: { query: { weeks } } })),
  });
}

export function DashboardsPage() {
  const { projectId } = useParams({ strict: false });
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);
  const dashboard = useDashboard(projectId, weeks);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">Dashboards</h2>
        <div role="group" aria-label="Weeks" className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={w === weeks ? "default" : "ghost"}
              aria-pressed={w === weeks}
              onClick={() => setWeeks(w)}
            >
              {w} weeks
            </Button>
          ))}
        </div>
      </header>
      {dashboard.isPending ? (
        <Loading />
      ) : dashboard.isError ? (
        <QueryError error={dashboard.error} />
      ) : (
        <DashboardBody data={dashboard.data} />
      )}
    </section>
  );
}

function DashboardBody({ data }: { data: ProjectDashboard | Dashboard }) {
  const projects = "projects" in data ? data.projects : null;
  if (isEmpty(data)) {
    return (
      <p className="text-muted-foreground">
        No tickets or agent tasks in these weeks. Charts appear once there are some.
      </p>
    );
  }
  const partial = new Set(data.partial);
  return (
    <>
      {partial.has("projects") && (
        <p className="text-sm text-muted-foreground">
          <Badge variant="attention">Partial</Badge> Only the first {projects?.length} projects are
          counted: a read cap was reached.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <TicketsByStage weeks={data.weeks} partial={partial} />
        <LeadTime weeks={data.weeks} partial={partial} />
        <ReworkAndBlockers weeks={data.weeks} partial={partial} />
        <CiGreen weeks={data.weeks} partial={partial} />
      </div>
      <CostCharts weeks={data.weeks} partial={partial} />
      <ExpensiveRuns runs={data.expensiveRuns} partial={partial} />
      {projects && <ProjectBreakdown projects={projects} />}
    </>
  );
}

const isEmpty = (data: ProjectDashboard | Dashboard) =>
  data.weeks.every(
    (w) => w.cost.runs === 0 && Object.values(w.ticketsByStage).every((n) => n === 0),
  );

/** A titled chart card; says when its figure is partial, or shows `empty` instead of a chart. */
function ChartCard(props: {
  title: string;
  figures: DashboardFigure[];
  partial: Set<DashboardFigure>;
  empty: string | null;
  note?: ReactNode;
  children: ReactNode;
}) {
  const isPartial = props.figures.some((f) => props.partial.has(f));
  return (
    <section aria-label={props.title} className="space-y-2 rounded-md border border-border p-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        {props.title}
        {isPartial && <Badge variant="attention">Partial: a read cap was reached</Badge>}
      </h3>
      {props.empty ? (
        <p className="text-sm text-muted-foreground">{props.empty}</p>
      ) : (
        props.children
      )}
      {props.note && <p className="text-xs text-muted-foreground">{props.note}</p>}
    </section>
  );
}

function TicketsByStage({
  weeks,
  partial,
}: {
  weeks: DashboardWeek[];
  partial: Set<DashboardFigure>;
}) {
  const config: ChartConfig = Object.fromEntries(
    STAGES.map((s) => [s.stage, { label: s.label, color: s.color }]),
  );
  const rows = weeks.map((w) => ({ week: weekLabel(w.start), ...w.ticketsByStage }));
  return (
    <ChartCard
      title="Tickets by stage"
      figures={["ticketsByStage"]}
      partial={partial}
      empty={null}
      note="At each week's end, archived tickets included."
    >
      <WeekChart config={config} rows={rows}>
        {STAGES.map((s) => (
          <Bar
            key={s.stage}
            dataKey={s.stage}
            stackId="stage"
            fill={chartColor(s.stage)}
            isAnimationActive={false}
          />
        ))}
      </WeekChart>
    </ChartCard>
  );
}

function LeadTime({ weeks, partial }: { weeks: DashboardWeek[]; partial: Set<DashboardFigure> }) {
  const config: ChartConfig = {
    median: { label: "Median hours", color: "var(--running)" },
    p90: { label: "90th percentile hours", color: "var(--attention)" },
  };
  const rows = weeks.map((w) => ({
    week: weekLabel(w.start),
    median: w.leadTimeHours.median,
    p90: w.leadTimeHours.p90,
  }));
  const done = weeks.reduce((n, w) => n + w.leadTimeHours.count, 0);
  return (
    <ChartCard
      title="Lead time"
      figures={["leadTime"]}
      partial={partial}
      empty={done ? null : "No tickets reached Done in these weeks."}
      note="Hours from Ready (or In progress) to Done, for tickets done that week."
    >
      <WeekChart config={config} rows={rows} kind="line">
        <Line
          dataKey="median"
          stroke={chartColor("median")}
          dot={false}
          isAnimationActive={false}
        />
        <Line dataKey="p90" stroke={chartColor("p90")} dot={false} isAnimationActive={false} />
      </WeekChart>
    </ChartCard>
  );
}

function ReworkAndBlockers({
  weeks,
  partial,
}: {
  weeks: DashboardWeek[];
  partial: Set<DashboardFigure>;
}) {
  const config: ChartConfig = {
    reworks: { label: "Reworks", color: "var(--attention)" },
    reviewBlockers: { label: "Review blockers", color: "var(--destructive)" },
  };
  const rows = weeks.map((w) => ({
    week: weekLabel(w.start),
    reworks: w.reworks,
    reviewBlockers: w.reviewBlockers,
  }));
  const any = rows.some((r) => r.reworks || r.reviewBlockers);
  return (
    <ChartCard
      title="Rework and review blockers"
      figures={["reworks", "reviewBlockers"]}
      partial={partial}
      empty={any ? null : "No rework or review blockers in these weeks."}
      note="Reworks: moves from Ready for review back to In progress. Blockers: failed review checks."
    >
      <WeekChart config={config} rows={rows}>
        <Bar dataKey="reworks" fill={chartColor("reworks")} isAnimationActive={false} />
        <Bar
          dataKey="reviewBlockers"
          fill={chartColor("reviewBlockers")}
          isAnimationActive={false}
        />
      </WeekChart>
    </ChartCard>
  );
}

function CiGreen({ weeks, partial }: { weeks: DashboardWeek[]; partial: Set<DashboardFigure> }) {
  const config: ChartConfig = {
    percent: { label: "Green on first try (%)", color: "var(--success)" },
  };
  const rows = weeks.map((w) => ({
    week: weekLabel(w.start),
    percent: w.ciGreenFirstTry.rate === null ? null : Math.round(w.ciGreenFirstTry.rate * 100),
  }));
  const green = weeks.reduce((n, w) => n + w.ciGreenFirstTry.green, 0);
  const known = weeks.reduce((n, w) => n + w.ciGreenFirstTry.known, 0);
  return (
    <ChartCard
      title="CI green on first try"
      figures={["ciGreenFirstTry"]}
      partial={partial}
      empty={known ? null : "No closed agent task PRs in these weeks."}
      note={`${green} of ${known} PRs green on the first try.`}
    >
      <WeekChart config={config} rows={rows}>
        <Bar dataKey="percent" fill={chartColor("percent")} isAnimationActive={false} />
      </WeekChart>
    </ChartCard>
  );
}

type Breakdown = "step" | "size";
const METRICS: {
  key: "cost" | "tokens" | "quota";
  title: string;
  value: (c: DashboardCost) => number | null;
}[] = [
  { key: "cost", title: "Cost (USD, estimate)", value: (c) => round2(c.estimatedCostUsd) },
  { key: "tokens", title: "Tokens", value: (c) => c.tokensIn + c.tokensOut },
  { key: "quota", title: "Weekly quota used (points)", value: (c) => c.quotaDelta.weekly },
];
const round2 = (n: number) => Math.round(n * 100) / 100;

const SIZE_LABEL: Record<string, string> = { S: "S", M: "M", L: "L", unsized: "Unsized" };

/** Cost, tokens and quota per week, split by agent task step or by ticket size. */
function CostCharts({ weeks, partial }: { weeks: DashboardWeek[]; partial: Set<DashboardFigure> }) {
  const [by, setBy] = useState<Breakdown>("step");
  const groups = (w: DashboardWeek) =>
    by === "step"
      ? w.byStep.map((c) => ({ name: c.step, cost: c }))
      : w.bySize.map((c) => ({ name: c.size, cost: c }));
  // Only groups with an agent task in the window get a series, so colours stay distinct.
  const names = [
    ...new Set(
      weeks.flatMap((w) =>
        groups(w)
          .filter((g) => g.cost.runs > 0)
          .map((g) => g.name),
      ),
    ),
  ];
  const config: ChartConfig = Object.fromEntries(
    names.map((n, i) => [
      n,
      { label: by === "step" ? n : (SIZE_LABEL[n] ?? n), color: PALETTE[i % PALETTE.length] },
    ]),
  );
  const runs = weeks.reduce((n, w) => n + w.cost.runs, 0);
  const unknown = weeks.reduce((n, w) => n + w.cost.unknownCostRuns, 0);
  const total = weeks.reduce((n, w) => n + w.cost.estimatedCostUsd, 0);

  return (
    <section aria-label="Cost" className="space-y-2">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Cost, tokens and quota</h3>
        <div role="group" aria-label="Split by" className="flex gap-1">
          {(["step", "size"] as const).map((b) => (
            <Button
              key={b}
              size="sm"
              variant={b === by ? "default" : "ghost"}
              aria-pressed={b === by}
              onClick={() => setBy(b)}
            >
              By {b}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {runs} agent tasks · {usd(total)} estimated
          {unknown ? ` · ${unknown} with unknown cost` : ""}
        </span>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        {METRICS.map((m) => {
          const rows = weeks.map((w) => ({
            week: weekLabel(w.start),
            ...Object.fromEntries(groups(w).map((g) => [g.name, m.value(g.cost)])),
          }));
          return (
            <ChartCard
              key={m.key}
              title={m.title}
              figures={["cost"]}
              partial={partial}
              empty={names.length ? null : "No agent tasks finished in these weeks."}
            >
              <WeekChart config={config} rows={rows}>
                {names.map((n) => (
                  <Bar
                    key={n}
                    dataKey={n}
                    stackId={m.key}
                    fill={chartColor(n)}
                    isAnimationActive={false}
                  />
                ))}
              </WeekChart>
            </ChartCard>
          );
        })}
      </div>
    </section>
  );
}

/** One chart over the weeks: bars (default) or lines, with a tooltip and legend. */
function WeekChart(props: {
  config: ChartConfig;
  rows: Record<string, unknown>[];
  kind?: "bar" | "line";
  children: ReactNode;
}) {
  const Chart = props.kind === "line" ? LineChart : BarChart;
  return (
    <ChartContainer config={props.config} className="h-48 w-full" initialDimension={INITIAL_SIZE}>
      <Chart data={props.rows} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(v: number) => compact.format(v)}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {props.children}
      </Chart>
    </ChartContainer>
  );
}

function ExpensiveRuns({ runs, partial }: { runs: DashboardRun[]; partial: Set<DashboardFigure> }) {
  return (
    <ChartCard
      title="Most expensive agent tasks"
      figures={["expensiveRuns"]}
      partial={partial}
      empty={runs.length ? null : "No agent tasks with a known cost in these weeks."}
    >
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="h-8 text-left">
            <th className="font-normal">Agent task</th>
            <th className="font-normal">Ticket</th>
            <th className="text-right font-normal">Cost</th>
            <th className="text-right font-normal">Ended</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="h-8 border-t border-border">
              <td>
                <Link
                  to="/p/$projectId/runs/$runId"
                  params={{ projectId: r.projectId, runId: r.id }}
                  className="underline-offset-2 hover:underline"
                >
                  Agent task · {r.step}
                </Link>
              </td>
              <td className="tabular-nums">
                {r.ticketKey ? (
                  <Link
                    to="/p/$projectId/t/$ticketRef"
                    params={{ projectId: r.projectId, ticketRef: r.ticketKey }}
                    className="underline-offset-2 hover:underline"
                  >
                    {r.ticketKey}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">No ticket</span>
                )}
              </td>
              <td className="text-right tabular-nums">
                {usd(r.costUsd)}
                {r.costIsEstimate ? " (estimate)" : ""}
              </td>
              <td className="text-right text-xs text-muted-foreground tabular-nums">
                {weekLabel(r.endedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  );
}

/** All projects: each project's window totals, linking to its own dashboard. */
function ProjectBreakdown({ projects }: { projects: ProjectDashboard[] }) {
  return (
    <section aria-label="By project" className="space-y-2 rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">By project</h3>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="h-8 text-left">
            <th className="font-normal">Project</th>
            <th className="text-right font-normal">Done</th>
            <th className="text-right font-normal">Reworks</th>
            <th className="text-right font-normal">Agent tasks</th>
            <th className="text-right font-normal">Tokens</th>
            <th className="text-right font-normal">Cost</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const sum = (f: (w: DashboardWeek) => number) => p.weeks.reduce((n, w) => n + f(w), 0);
            return (
              <tr key={p.projectId} className="h-8 border-t border-border tabular-nums">
                <td>
                  <Link
                    to="/p/$projectId/dashboards"
                    params={{ projectId: p.projectId }}
                    className="underline-offset-2 hover:underline"
                  >
                    {p.key}
                  </Link>
                  {p.partial.length > 0 && (
                    <Badge variant="attention" className="ml-2">
                      Partial
                    </Badge>
                  )}
                </td>
                <td className="text-right">{p.weeks.at(-1)?.ticketsByStage.done ?? 0}</td>
                <td className="text-right">{sum((w) => w.reworks)}</td>
                <td className="text-right">{sum((w) => w.cost.runs)}</td>
                <td className="text-right">
                  {compact.format(sum((w) => w.cost.tokensIn + w.cost.tokensOut))}
                </td>
                <td className="text-right">{usd(sum((w) => w.cost.estimatedCostUsd))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
