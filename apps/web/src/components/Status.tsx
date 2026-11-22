import { Button } from "@/components/ui/button";
import { ApiError, errorText } from "@/lib/api";

export function Loading() {
  return <p className="text-muted-foreground">Loading…</p>;
}

/**
 * Errors are shown, never swallowed, so a broken call is visible on screen. The API's message
 * when it sent one; else a sentence naming `what` couldn't be read, with the status (AI-332).
 * `onRetry` adds a Retry button (reads; a failed save is retried by saving again).
 */
export function QueryError({
  error,
  what,
  onRetry,
}: {
  error: unknown;
  /** What the failed read was for, e.g. "the GitHub connection". */
  what?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      <p>{queryErrorText(error, what)}</p>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** The line `QueryError` shows. */
export function queryErrorText(error: unknown, what?: string): string {
  if (error instanceof ApiError && !error.fromApi) {
    return what
      ? `Couldn't read ${what} (${error.status}).`
      : `The request failed (${error.status}) without saying why.`;
  }
  return errorText(error);
}
