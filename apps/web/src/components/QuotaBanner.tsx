import type { QuotaStatus } from "@andy/contracts";
import { ClearQuotaIdle } from "@/components/ClearQuotaIdle";
import { WINDOW_LABEL } from "@/components/QuotaGauge";
import { useQuota } from "@/lib/queries";
import { cn } from "@/lib/utils";

function atLevel(status: QuotaStatus): string {
  return status.windows
    .filter((w) => w.level === status.level)
    .map((w) => `${WINDOW_LABEL[w.window]} ${Math.round(w.usedPct ?? 0)}%`)
    .join(", ");
}

/**
 * Persistent while the level holds; there is no dismiss control (§7). At the pause level dispatch
 * starts nothing new (ADR-0079), and Andy can clear a reading he doesn't believe (AI-74). A failed
 * fetch counts as unknown.
 */
export function QuotaBanner() {
  const quota = useQuota();
  if (quota.isPending) return null;
  const status = quota.data;
  const level = status?.level ?? "unknown";
  if (level === "ok") return null;

  if (level === "unknown" || !status) {
    return (
      <p
        role="status"
        className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground sm:px-6"
      >
        Claude quota unknown: no fresh reading. Don&apos;t assume there is headroom.
      </p>
    );
  }
  const pause = level === "pause";
  return (
    <p
      role="alert"
      className={cn(
        "border-b border-border px-4 py-1.5 text-sm font-medium sm:px-6",
        pause ? "bg-destructive/15 text-destructive" : "bg-attention/15 text-attention",
      )}
    >
      {pause
        ? `Claude quota at the pause level (${status.pausePct}%): ${atLevel(status)}. Dispatch starts nothing new until it drops.`
        : `Claude quota past the warning level (${status.warnPct}%): ${atLevel(status)}.`}
      {pause && <ClearQuotaIdle />}
    </p>
  );
}
