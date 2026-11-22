import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConfigChange } from "@andy/contracts";
import { QueryError } from "@/components/Status";
import { errorText, unwrap, useApi } from "@/lib/api";
import { useLivePoll } from "@/lib/live";
import { parseUsd, usd } from "./SpendCaps";

/**
 * The global spend caps (AI-276) on Settings → Models: the ceiling every project's own caps can
 * only lower. Andy edits them in dollars (whole cents); a save is checked against the caps read,
 * so someone else's save in between is refused. Each save is in the change log below, with
 * Revert. Nothing stored yet means the code defaults.
 */

type Cap = "dailyMicroUsd" | "monthlyMicroUsd" | "perTaskMicroUsd";
const CAPS: { field: Cap; label: string }[] = [
  { field: "dailyMicroUsd", label: "Daily" },
  { field: "monthlyMicroUsd", label: "Monthly" },
  { field: "perTaskMicroUsd", label: "Per task" },
];

function useGlobalSpendCaps() {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    queryKey: ["global-spend-caps"],
    queryFn: async () => unwrap(await api.GET("/api/spend-caps")),
  });
}

function useSpendCapChanges() {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    queryKey: ["global-spend-caps", "changes"],
    queryFn: async () => unwrap(await api.GET("/api/spend-caps/changes")),
  });
}

const input =
  "h-7 w-24 rounded-md border border-border bg-background px-2 text-sm tabular-nums disabled:opacity-50 max-sm:h-11 max-sm:text-base";
const button =
  "rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 max-sm:min-h-11 max-sm:px-3";

export function GlobalSpendCaps() {
  const api = useApi();
  const queryClient = useQueryClient();
  const global = useGlobalSpendCaps();
  const [draft, setDraft] = useState<Partial<Record<Cap, string>>>({});
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: async (body: {
      caps: Record<Cap, number>;
      ifUpdatedAt: string | null;
      reason?: string;
    }) => unwrap(await api.PUT("/api/spend-caps", { body })),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  if (global.error) return <QueryError error={global.error} />;
  if (!global.data) return null;
  const view = global.data;
  const text = (field: Cap) => draft[field] ?? usd(view.caps[field]).slice(1);
  const parsed = Object.fromEntries(
    CAPS.map(({ field }) => [field, parseUsd(text(field))]),
  ) as Record<Cap, number | null | undefined>;
  // A global cap can't be empty: there is nothing above it to fall back to.
  const invalid = CAPS.filter(({ field }) => typeof parsed[field] !== "number");
  const changed = Object.keys(draft).length > 0;

  return (
    <section aria-label="Global spend caps" className="space-y-2">
      <h3 className="text-sm font-medium">Spend caps</h3>
      <p className="text-xs text-muted-foreground">
        Paid models only; the Claude subscription never counts. Global is the ceiling: each project
        can only lower it in its settings.{" "}
        {view.source === "default" ? "These are the code defaults; nothing is saved yet." : ""}
      </p>
      <div className="flex flex-wrap gap-4">
        {CAPS.map(({ field, label }) => (
          <label key={field} className="flex items-center gap-2 text-sm">
            {label} $
            <input
              aria-label={`Global ${label.toLowerCase()} cap, in dollars`}
              className={input}
              inputMode="decimal"
              value={text(field)}
              disabled={save.isPending}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            />
          </label>
        ))}
      </div>
      {invalid.length > 0 && (
        <p className="text-xs text-destructive">
          {invalid.map((c) => c.label).join(", ")}: dollars with at most two decimals.
        </p>
      )}
      {save.error && <p className="text-xs text-destructive">{errorText(save.error)}</p>}
      {changed && (
        <div className="flex items-center gap-2">
          <input
            aria-label="Reason for the global change"
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
                  // Only edited caps take the typed (whole-cent) value; the others keep their
                  // exact stored micro-dollars, so a save never rounds a cap Andy didn't touch.
                  caps: Object.fromEntries(
                    CAPS.map(({ field }) => [
                      field,
                      field in draft ? (parsed[field] as number) : view.caps[field],
                    ]),
                  ) as Record<Cap, number>,
                  ifUpdatedAt: view.updatedAt,
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
            Save global caps
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
      <SpendCapChanges onReverted={() => setDraft({})} />
    </section>
  );
}

/** The global caps' change log: each cap's before and after, who, when, why, with Revert. */
function SpendCapChanges({ onReverted }: { onReverted: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const changes = useSpendCapChanges();
  const revert = useMutation({
    mutationFn: async (changeId: string) =>
      unwrap(
        await api.POST("/api/spend-caps/changes/{changeId}/revert", {
          params: { path: { changeId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return (
    <div aria-label="Spend caps changes" role="region" className="space-y-1">
      {changes.error && <QueryError error={changes.error} />}
      {revert.error && <p className="text-xs text-destructive">{errorText(revert.error)}</p>}
      {changes.data?.length === 0 && (
        <p className="text-xs text-muted-foreground">No global spend caps changes yet.</p>
      )}
      {changes.data && changes.data.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {changes.data.map((c) => (
            <ChangeRow
              key={c.id}
              change={c}
              reverting={revert.isPending}
              onRevert={() => revert.mutate(c.id, { onSuccess: onReverted })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const LABEL: Record<string, string> = {
  dailyMicroUsd: "daily",
  monthlyMicroUsd: "monthly",
  perTaskMicroUsd: "per task",
};

function ChangeRow({
  change,
  reverting,
  onRevert,
}: {
  change: ConfigChange;
  reverting: boolean;
  onRevert: () => void;
}) {
  const what = Object.entries(change.diff).map(([field, v]) => {
    const { from, to } = v as { from: number; to: number };
    return `${LABEL[field] ?? field} ${usd(from)} → ${usd(to)}`;
  });
  return (
    <li aria-label={`Change ${change.id}`} className="flex items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="tabular-nums">{what.join("; ")}</p>
        <p className="text-xs text-muted-foreground">
          {change.actor === "andy" ? "Andy" : change.actor} ·{" "}
          {new Date(change.createdAt).toLocaleString()}
          {change.reason && ` · ${change.reason}`}
        </p>
      </div>
      {change.status === "applied" ? (
        <button type="button" className={button} disabled={reverting} onClick={onRevert}>
          Revert
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">
          {change.status === "reverted" ? "Reverted" : change.status}
        </span>
      )}
    </li>
  );
}
