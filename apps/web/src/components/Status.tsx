import { errorText } from "@/lib/api";

export function Loading() {
  return <p className="text-muted-foreground">Loading…</p>;
}

/** Errors are shown, never swallowed, so a broken call is visible on screen. */
export function QueryError({ error }: { error: unknown }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {errorText(error)}
    </p>
  );
}
