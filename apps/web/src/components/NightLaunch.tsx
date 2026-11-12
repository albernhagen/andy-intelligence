import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loading, QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { unwrap, useApi } from "@/lib/api";
import type { components } from "@/lib/api.gen";
import { showsError, useLivePoll } from "@/lib/live";

type NightStatus = components["schemas"]["NightStatus"];
type Story = NightStatus["stories"][number];
type TicketPath = { projectId: string; ticketId: string };

const PLAN_LABEL: Record<Story["plan"]["kind"], string> = {
  none: "No plan yet",
  planning: "Plan still running",
  awaiting: "Plan awaiting approval",
  approved: "Plan approved",
  rejected: "Plan rejected",
  stale: "Plan stale",
};

/** The epic's night launch checklist and latest launch (M4.17), polled slowly like the roll-up. */
export function useNightStatus(path: TicketPath) {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    queryKey: ["night", path],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets/{ticketId}/night", { params: { path } }),
      ),
  });
}

function useNightWrite<V>(fn: (vars: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => queryClient.invalidateQueries() });
}

/** "3 of 10 agent tasks · 120,000 of 1,000,000 tokens · ~$1.23 of $20 (estimate)". */
export function formatSpend(
  spend: NonNullable<NightStatus["progress"]>["spend"],
  budget: NonNullable<NightStatus["launch"]>["budget"],
): string {
  const n = (v: number) => v.toLocaleString("en-US");
  return [
    `${spend.runs} of ${budget.maxRuns} agent tasks`,
    `${n(spend.tokens)} of ${n(budget.maxTokens)} tokens`,
    `~$${spend.estimatedUsd.toFixed(2)} of $${budget.maxUsd} (estimate)`,
    spend.unknownRuns > 0 &&
      `${spend.unknownRuns} ${spend.unknownRuns === 1 ? "agent task" : "agent tasks"} unknown`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * "Plan the night" (ADR-0049 launch step): every story's open questions and plan with links,
 * the budget and stop time, Launch (off, with the reasons, while anything is open), and while a
 * launch runs its progress, spend against budget and Stop.
 */
export function NightLaunch(path: TicketPath) {
  const night = useNightStatus(path);
  const n = night.data;
  return (
    <section aria-label="Plan the night" className="space-y-2">
      <h3 className="text-sm font-medium">Plan the night</h3>
      {night.isPending && <Loading />}
      {showsError(night) && <QueryError error={night.error} />}
      {n && (
        <>
          <Checklist projectId={path.projectId} night={n} />
          {n.launch && n.launch.status !== "ended" ? (
            <Running path={path} night={n} />
          ) : (
            <>
              {n.launch && (
                <p className="text-xs text-muted-foreground">
                  Last launch ended: {n.launch.endReason ?? "unknown"}.
                </p>
              )}
              <LaunchForm path={path} night={n} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function Checklist({ projectId, night }: { projectId: string; night: NightStatus }) {
  const byKey = new Map<string | null, NightStatus["problems"]>();
  for (const p of night.problems) byKey.set(p.ticketKey, [...(byKey.get(p.ticketKey) ?? []), p]);
  const storyKeys = new Set(night.stories.map((s) => s.key));
  const general = night.problems.filter((p) => !storyKeys.has(p.ticketKey ?? ""));
  return (
    <div className="space-y-2">
      {general.length > 0 && (
        <ul aria-label="Launch problems" className="list-disc pl-5 text-sm text-destructive">
          {general.map((p) => (
            <li key={`${p.kind}-${p.ticketKey}`}>{p.message}</li>
          ))}
        </ul>
      )}
      {night.stories.length > 0 && (
        <ul
          aria-label="Launch checklist"
          className="divide-y divide-border rounded-md border border-border text-sm"
        >
          {night.stories.map((s) => {
            const open = byKey.get(s.key) ?? [];
            return (
              <li key={s.id} className="space-y-1 px-2 py-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/p/$projectId/t/$ticketRef"
                    params={{ projectId, ticketRef: s.key }}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    <span className="text-muted-foreground tabular-nums">{s.key}:</span> {s.title}
                  </Link>
                  {open.length === 0 ? (
                    <Badge variant="success">Clear</Badge>
                  ) : (
                    <Badge variant="attention">
                      {open.length} {open.length === 1 ? "problem" : "problems"}
                    </Badge>
                  )}
                </div>
                {s.questions.map((q) => (
                  <Link
                    key={q.id}
                    to="/p/$projectId/t/$ticketRef"
                    params={{ projectId, ticketRef: s.key }}
                    className="block pl-4 text-xs text-muted-foreground hover:underline"
                  >
                    Question: {q.text}
                  </Link>
                ))}
                {s.plan.kind !== "approved" && (s.size !== "S" || s.plan.runId) && (
                  <PlanLine projectId={projectId} story={s} />
                )}
                {/* Questions and plans have their own linked lines above. */}
                {open
                  .filter((p) => p.kind !== "open_questions" && p.kind !== "plan_not_approved")
                  .map((p) => (
                    <p key={p.kind} className="pl-4 text-xs text-attention">
                      {p.message.replace(`${s.key}: `, "")}
                    </p>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PlanLine({ projectId, story }: { projectId: string; story: Story }) {
  const label = PLAN_LABEL[story.plan.kind];
  const cls = "block pl-4 text-xs text-muted-foreground";
  return story.plan.runId ? (
    <Link
      to="/p/$projectId/runs/$runId"
      params={{ projectId, runId: story.plan.runId }}
      className={`${cls} hover:underline`}
    >
      {label}
    </Link>
  ) : (
    <p className={cls}>{label}</p>
  );
}

/** Local `datetime-local` value → ISO time; empty or invalid → null (the API names the problem). */
function isoOf(local: string): string | null {
  const t = Date.parse(local);
  return local && Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function LaunchForm({ path, night }: { path: TicketPath; night: NightStatus }) {
  const api = useApi();
  const [maxRuns, setMaxRuns] = useState("20");
  const [maxTokens, setMaxTokens] = useState("5000000");
  const [maxUsd, setMaxUsd] = useState("50");
  const [stopAt, setStopAt] = useState("");
  const launch = useNightWrite(async () =>
    unwrap(
      await api.POST("/api/projects/{projectId}/tickets/{ticketId}/night", {
        params: { path },
        body: {
          budget: {
            maxRuns: numberOrNull(maxRuns),
            maxTokens: numberOrNull(maxTokens),
            maxUsd: numberOrNull(maxUsd),
          },
          stopAt: isoOf(stopAt),
        },
      }),
    ),
  );
  const blocked = night.problems.length > 0;
  const { limits } = night;
  return (
    <form
      aria-label="Launch the night"
      className="space-y-2 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        launch.mutate(undefined);
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={`Max agent tasks (≤ ${limits.maxRuns})`}>
          <Input inputMode="numeric" value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} />
        </Field>
        <Field label={`Max tokens (≤ ${limits.maxTokens.toLocaleString("en-US")})`}>
          <Input
            inputMode="numeric"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
          />
        </Field>
        <Field label={`Max USD (≤ ${limits.maxUsd})`}>
          <Input inputMode="decimal" value={maxUsd} onChange={(e) => setMaxUsd(e.target.value)} />
        </Field>
        <Field label={`Stop time (within ${limits.maxHours} h)`}>
          <Input type="datetime-local" value={stopAt} onChange={(e) => setStopAt(e.target.value)} />
        </Field>
      </div>
      {blocked && (
        <p className="text-xs text-muted-foreground">
          Launch is off until the checklist is clear:{" "}
          {night.problems.map((p) => p.message).join("; ")}
        </p>
      )}
      {launch.error && <QueryError error={launch.error} />}
      <Button type="submit" size="sm" disabled={blocked || launch.isPending}>
        Launch
      </Button>
    </form>
  );
}

function Running({ path, night }: { path: TicketPath; night: NightStatus }) {
  const api = useApi();
  const stop = useNightWrite(async () =>
    unwrap(
      await api.POST("/api/projects/{projectId}/tickets/{ticketId}/night/stop", {
        params: { path },
      }),
    ),
  );
  const launch = night.launch!;
  const p = night.progress;
  const stopping = launch.status === "stopping";
  return (
    <div
      aria-label="Night launch"
      className="space-y-1 rounded-md border border-border p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={stopping ? "attention" : "running"}>
          {stopping ? "Stopping" : "Running"}
        </Badge>
        <span className="text-muted-foreground">
          until {new Date(launch.stopAt).toLocaleString()}
        </span>
      </div>
      {p && (
        <>
          <p aria-label="Night progress" className="tabular-nums">
            {p.stories.done} of {p.stories.total} stories done · {p.stories.running} running ·{" "}
            {p.stories.stopped} stopped · {p.stories.waiting} waiting
          </p>
          <p aria-label="Night spend" className="text-muted-foreground tabular-nums">
            {formatSpend(p.spend, launch.budget)}
          </p>
        </>
      )}
      {stopping ? (
        <p className="text-xs text-muted-foreground">
          No new agent tasks start; the ones in flight finish.
        </p>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={stop.isPending}
          onClick={() => stop.mutate(undefined)}
        >
          Stop
        </Button>
      )}
      {stop.error && <QueryError error={stop.error} />}
    </div>
  );
}
