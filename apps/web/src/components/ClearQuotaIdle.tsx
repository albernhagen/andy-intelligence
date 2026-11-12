import { errorText } from "@/lib/api";
import { useClearQuotaIdle, useQuota } from "@/lib/queries";

/**
 * Andy's clear of a quota idle (AI-74), beside the idle reason on the settings page and in the
 * quota banner: shown only while a reading holds dispatch at the reserve. The API refuses a
 * second clear of the same reading; the clear shows in the digest.
 */
export function ClearQuotaIdle() {
  const quota = useQuota();
  const clear = useClearQuotaIdle();
  if (quota.data?.level !== "pause") return null;
  return (
    <span className="ml-3 inline-flex items-center gap-1">
      <button
        type="button"
        className="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        title="Discard the quota reading holding dispatch at the reserve, if you don't believe it. Quota reads unknown until the next agent task reports."
        disabled={clear.isPending}
        onClick={() => clear.mutate()}
      >
        Clear quota idle
      </button>
      {/* A span, not QueryError's <p>: this sits inside the banner's paragraph. */}
      {clear.error && <span className="text-destructive">{errorText(clear.error)}</span>}
    </span>
  );
}
