import type { QuotaLevel, QuotaWindow } from "@andy/contracts";
import { useQuota } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const WINDOW_LABEL: Record<QuotaWindow, string> = {
  "5h": "5-hour",
  weekly: "Weekly",
  daily_tasks: "Daily tasks",
};

const BAR: Record<QuotaLevel, string> = {
  ok: "bg-primary",
  warn: "bg-attention",
  pause: "bg-destructive",
  unknown: "bg-muted",
};

/** Used % per subscription window. A stale or missing reading shows "unknown", never a number. */
export function QuotaGauge() {
  const quota = useQuota();
  if (!quota.data) return null;
  return (
    <ul aria-label="Claude quota" className="hidden items-center gap-3 text-xs md:flex">
      {quota.data.windows.map((w) => {
        const label = WINDOW_LABEL[w.window];
        return (
          <li key={w.window} className="flex items-center gap-1.5 text-muted-foreground">
            {label}
            {w.usedPct === null ? (
              <span>unknown</span>
            ) : (
              <>
                <span
                  role="meter"
                  aria-label={`${label} quota used`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={w.usedPct}
                  className="h-1.5 w-12 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className={cn("block h-full", BAR[w.level])}
                    style={{ width: `${w.usedPct}%` }}
                  />
                </span>
                <span className="tabular-nums">{Math.round(w.usedPct)}%</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
