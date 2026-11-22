/**
 * The quiet "Saved" cue after a setting saves (AI-339), the same on project settings and Models:
 * "Saving…" while the write is in flight, "Saved" once it lands. A failure shows its own error.
 */
export function SavedCue({ pending, saved }: { pending: boolean; saved: boolean }) {
  if (!pending && !saved) return null;
  return (
    <span role="status" className="ml-2 text-xs text-muted-foreground">
      {pending ? "Saving…" : "Saved"}
    </span>
  );
}
