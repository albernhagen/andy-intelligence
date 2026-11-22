import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryError } from "@/components/Status";
import { errorText, unwrap, useApi } from "@/lib/api";
import { useLivePoll } from "@/lib/live";

/**
 * A project's spend caps (AI-249: M10.8) on its settings page: the global caps (code defaults
 * until AI-276), the project's own, the caps a paid call is checked against, and spend today and
 * this month. Andy may set the project's own caps; the API refuses one above the global cap and
 * says why, and every change lands in the Changes log below, revertable there.
 */

type Cap = "dailyMicroUsd" | "monthlyMicroUsd" | "perTaskMicroUsd";
const CAPS: {
  field: Cap;
  label: string;
  effective: "project_daily" | "project_monthly" | "per_task";
}[] = [
  { field: "dailyMicroUsd", label: "Daily", effective: "project_daily" },
  { field: "monthlyMicroUsd", label: "Monthly", effective: "project_monthly" },
  { field: "perTaskMicroUsd", label: "Per task", effective: "per_task" },
];

/** `$5.00` from micro-dollars: whole cents, rounded down. */
export function usd(microUsd: number): string {
  const cents = Math.floor(microUsd / 10_000);
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Micro-dollars from what Andy typed: dollars with at most two decimals, parsed as whole cents so
 * no float ever reaches the API. Empty means "take the global cap" (null); anything else is
 * `undefined` (invalid).
 */
export function parseUsd(text: string): number | null | undefined {
  const t = text.trim().replace(/^\$/, "");
  if (t === "") return null;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return undefined;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents * 10_000;
}

const toText = (microUsd: number | null | undefined) =>
  microUsd === null || microUsd === undefined ? "" : usd(microUsd).slice(1);

function useSpend(projectId: string) {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    queryKey: ["spend", projectId],
    queryFn: async () =>
      unwrap(await api.GET("/api/projects/{projectId}/spend", { params: { path: { projectId } } })),
  });
}

function useSetSpendCaps(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { caps: Partial<Record<Cap, number | null>>; reason?: string }) =>
      unwrap(
        await api.PUT("/api/projects/{projectId}/spend-caps", {
          params: { path: { projectId } },
          body,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

const input =
  "h-7 w-24 rounded-md border border-border bg-background px-2 text-sm tabular-nums disabled:opacity-50 max-sm:h-11 max-sm:text-base";
const button =
  "rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 max-sm:min-h-11 max-sm:px-3";

export function SpendCaps({ projectId }: { projectId: string }) {
  const spend = useSpend(projectId);
  const save = useSetSpendCaps(projectId);
  const [draft, setDraft] = useState<Partial<Record<Cap, string>>>({});
  const [reason, setReason] = useState("");

  if (spend.error) return <QueryError error={spend.error} />;
  if (!spend.data) return null;
  const view = spend.data;
  const text = (field: Cap) => draft[field] ?? toText(view.project[field]);
  const parsed = Object.fromEntries(
    CAPS.map(({ field }) => [field, parseUsd(text(field))]),
  ) as Record<Cap, number | null | undefined>;
  const invalid = CAPS.filter(({ field }) => parsed[field] === undefined);
  const changed = Object.keys(draft).length > 0;

  return (
    <section aria-label="Spend caps" className="space-y-2">
      <h3 className="text-sm font-medium">Spend caps</h3>
      <p className="text-xs text-muted-foreground">
        Paid models only; the Claude subscription never counts. A project cap can only be lower than
        the global one; empty takes the global cap. Global caps: Settings → Models.
      </p>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="text-left font-normal">Cap</th>
            <th className="text-left font-normal">
              {view.global.source === "default" ? "Global (default)" : "Global"}
            </th>
            <th className="text-left font-normal">This project ($)</th>
            <th className="text-left font-normal">In force</th>
          </tr>
        </thead>
        <tbody>
          {CAPS.map(({ field, label, effective }) => (
            <tr key={field} className="h-8">
              <td>{label}</td>
              <td className="tabular-nums">{usd(view.global.caps[field])}</td>
              <td>
                <input
                  aria-label={`${label} cap for this project, in dollars`}
                  className={input}
                  inputMode="decimal"
                  placeholder="global"
                  value={text(field)}
                  disabled={save.isPending}
                  onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                />
              </td>
              <td className="tabular-nums">{usd(view.effective[effective])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p aria-label="Spent" className="text-xs text-muted-foreground tabular-nums">
        {view.spent
          ? `Spent today ${usd(view.spent.project.dayMicroUsd)}, this month ${usd(view.spent.project.monthMicroUsd)} (all projects: ${usd(view.spent.global.dayMicroUsd)} today, ${usd(view.spent.global.monthMicroUsd)} this month).`
          : "Spent: unknown (the spend ledger can't be read)."}
      </p>
      {invalid.length > 0 && (
        <p className="text-xs text-destructive">
          {invalid.map((c) => c.label).join(", ")}: dollars with at most two decimals, or empty.
        </p>
      )}
      {save.error && <p className="text-xs text-destructive">{errorText(save.error)}</p>}
      {changed && (
        <div className="flex items-center gap-2">
          <input
            aria-label="Reason for the change"
            className={`${input} w-56`}
            placeholder="Why (optional)"
            value={reason}
            disabled={save.isPending}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className={button}
            disabled={save.isPending || invalid.length > 0}
            onClick={() =>
              save.mutate(
                {
                  // Only edited caps are sent (the API keeps the others as stored), so a save
                  // never rounds a cap Andy didn't touch to whole cents.
                  caps: Object.fromEntries(
                    CAPS.filter(({ field }) => field in draft).map(({ field }) => [
                      field,
                      parsed[field],
                    ]),
                  ),
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    setDraft({});
                    setReason("");
                  },
                },
              )
            }
          >
            Save caps
          </button>
          <button
            type="button"
            className={button}
            disabled={save.isPending}
            onClick={() => {
              setDraft({});
              save.reset();
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
