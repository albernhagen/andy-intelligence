import { useLiveStatus } from "@/lib/live";

/**
 * "Updates delayed" (AI-9): shown on every page while polls can't reach the API, cleared by the
 * next one that does. Mounting it starts the live-update watchers, so the shell mounts it once.
 */
export function LiveUpdatesBanner() {
  const { delayed } = useLiveStatus();
  if (!delayed) return null;
  return (
    <p
      role="status"
      className="border-b border-border bg-attention/15 px-4 py-1.5 text-xs text-attention sm:px-6"
    >
      Updates delayed: can&apos;t reach the server. Retrying; this page may be out of date.
    </p>
  );
}
