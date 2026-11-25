import type { QuotaLevel, QuotaStatus, QuotaWindow } from "@andy/contracts";
import { useQuota } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** The gauge is the only place an unknown reading shows (AI-328), so it says what that means. */
const UNKNOWN_HINT = "No fresh reading: don't assume there is headroom.";

/** The hint for screen readers; `title` alone isn't read on touch devices or by every reader. */
function Hint() {
  return <span className="sr-only">: {UNKNOWN_HINT}</span>;
}

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

const TEXT: Record<QuotaLevel, string> = {
  ok: "text-muted-foreground",
  warn: "text-attention",
  pause: "text-destructive",
  unknown: "text-muted-foreground",
};

/**
 * Used % per subscription window. A stale or missing reading shows "unknown", never a number.
 * Below `md` (phones, AI-176) only the fullest window fits in the header: "Quota 72%". A failed
 * read shows "Quota unknown" too: with no banner for unknown (AI-328), the gauge must never vanish.
 */
export function QuotaGauge() {
  const quota = useQuota();
  if (quota.isPending) return null;
  if (!quota.data)
    return (
      <span className="whitespace-nowrap text-xs text-muted-foreground" title={UNKNOWN_HINT}>
        Quota unknown
        <Hint />
      </span>
    );
  const known = quota.data.windows.filter((w) => w.usedPct !== null);
  const fullest = known.reduce<(typeof known)[number] | undefined>(
    (top, w) => (top && (top.usedPct ?? 0) >= (w.usedPct ?? 0) ? top : w),
    undefined,
  );
  return (
    <>
      <span
        className={cn(
          "whitespace-nowrap text-xs tabular-nums md:hidden",
          TEXT[fullest?.level ?? "unknown"],
        )}
        title={fullest ? `${WINDOW_LABEL[fullest.window]} window` : UNKNOWN_HINT}
      >
        {fullest ? `Quota ${Math.round(fullest.usedPct ?? 0)}%` : "Quota unknown"}
        {!fullest && <Hint />}
      </span>
      <QuotaWindows windows={quota.data.windows} />
    </>
  );
}

function QuotaWindows({ windows }: { windows: QuotaStatus["windows"] }) {
  return (
    <ul aria-label="Claude quota" className="hidden items-center gap-3 text-xs md:flex">
      {windows.map((w) => {
        const label = WINDOW_LABEL[w.window];
        return (
          <li key={w.window} className="flex items-center gap-1.5 text-muted-foreground">
            {label}
            {w.usedPct === null ? (
              <>
                <span title={UNKNOWN_HINT}>unknown</span>
                <Hint />
              </>
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

/**
 * The desktop sidebar's quota (AI-370): one small meter per window ("Claude 5-hour · 38%"). With no
 * reading at all, or none known, one quiet marker instead of a label per window; its hint says what
 * unknown means. A window unknown beside a known one says so in its own row.
 */
export function QuotaMeters() {
  const quota = useQuota();
  if (quota.isPending) return null;
  const windows = quota.data?.windows ?? [];
  if (!windows.some((w) => w.usedPct !== null))
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" title={UNKNOWN_HINT}>
        <span aria-hidden className="size-1.5 rounded-full border border-muted-foreground/60" />
        Quota unknown
        <Hint />
      </p>
    );
  return (
    <ul aria-label="Claude quota" className="space-y-1.5 text-xs text-muted-foreground">
      {windows.map((w, i) => {
        const label = `${i === 0 ? "Claude " : ""}${WINDOW_LABEL[w.window]}`;
        return (
          <li key={w.window} className="space-y-1">
            <span className={cn("block tabular-nums", TEXT[w.level])}>
              {label} · {w.usedPct === null ? "unknown" : `${Math.round(w.usedPct)}%`}
              {w.usedPct === null && <Hint />}
            </span>
            <span
              role="meter"
              aria-label={`${WINDOW_LABEL[w.window]} quota used`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={w.usedPct ?? undefined}
              aria-valuetext={w.usedPct === null ? "unknown" : undefined}
              className="block h-[3px] overflow-hidden rounded-full bg-border"
            >
              <span
                className={cn("block h-full", BAR[w.level])}
                style={{ width: `${w.usedPct ?? 0}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
