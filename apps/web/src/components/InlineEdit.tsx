import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { Ticket } from "@andy/contracts";
import { Markdown } from "@/components/Markdown";
import { QueryError } from "@/components/Status";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { type TicketPatch, ticketQueryKey, useUpdateTicket } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * In-place editing for the story panel (ADR-0059: "every field edits in place"). Each editor
 * saves only its own fields with `ifUpdatedAt`; a 409 asks Andy to reload, and his draft stays
 * so he can save again.
 */

/**
 * One save at a time per ticket. Each waits for the one before. It sends the `updatedAt` its
 * value was based on: the version when the editor opened (`begin`), or the rendered one for
 * one-click saves. That version is moved forward only through Andy's own saves (`ownSaves`), so
 * two quick edits in different fields never conflict, while a change made elsewhere still does,
 * even after polling (AI-9) has put the newer ticket in the cache.
 */
const saveQueues = new Map<string, Promise<void>>();
/** `ticketId:from` → `to` for each of Andy's own saves in this tab. */
const ownSaves = new Map<string, string>();

function latestOwnVersion(ticketId: string, base: string): string {
  let version = base;
  for (let next = ownSaves.get(`${ticketId}:${version}`); next;) {
    version = next;
    next = ownSaves.get(`${ticketId}:${version}`);
  }
  return version;
}

export function useTicketSave(ticket: Ticket) {
  const update = useUpdateTicket({ projectId: ticket.projectId, ticketId: ticket.id });
  const queryClient = useQueryClient();
  // Saves of this field queued or in flight: pending from the click, not only once it runs.
  const [inFlight, setInFlight] = useState(0);
  const began = useRef<string | null>(null);
  const begin = () => void (began.current = ticket.updatedAt);
  const save = (patch: Omit<TicketPatch, "ifUpdatedAt">, onSaved?: () => void) => {
    setInFlight((n) => n + 1);
    const base = began.current ?? ticket.updatedAt;
    const run = async () => {
      const ifUpdatedAt = latestOwnVersion(ticket.id, base);
      try {
        const saved = await update.mutateAsync({ ...patch, ifUpdatedAt });
        ownSaves.set(`${ticket.id}:${ifUpdatedAt}`, saved.updatedAt);
        // The saved ticket at once (before the refetch), so the panel shows it.
        queryClient.setQueryData(ticketQueryKey(saved.projectId, saved.key), saved);
        onSaved?.();
      } catch {
        // Shown through `update.error` next to the field.
      } finally {
        // After a save or a conflict, the next save is based on what is on screen then.
        began.current = null;
        setInFlight((n) => n - 1);
      }
    };
    const next = (saveQueues.get(ticket.id) ?? Promise.resolve()).then(run);
    saveQueues.set(ticket.id, next);
  };
  return {
    save,
    begin,
    pending: inFlight > 0,
    error: update.error ? <SaveError error={update.error} /> : null,
  };
}

/**
 * Unsaved typing in the panel, so leaving it can ask first (Andy never loses typed text
 * silently). The panel provides the set; each editor registers while it holds a draft.
 */
export const UnsavedDrafts = createContext<Set<string> | null>(null);

export function useUnsavedDraft(dirty: boolean) {
  const drafts = useContext(UnsavedDrafts);
  const id = useId();
  useEffect(() => {
    if (!drafts || !dirty) return;
    drafts.add(id);
    return () => void drafts.delete(id);
  }, [drafts, dirty, id]);
}

function SaveError({ error }: { error: Error }) {
  const queryClient = useQueryClient();
  const conflict = error instanceof ApiError && error.status === 409;
  return (
    <div className="space-y-1">
      <QueryError error={error} />
      {conflict && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          The ticket changed since you opened it. Reload to see the latest, then save again.
          <Button size="sm" variant="outline" onClick={() => void queryClient.invalidateQueries()}>
            Reload
          </Button>
        </p>
      )}
    </div>
  );
}

type SaveFn<T> = (value: T, onSaved: () => void) => void;

interface EditorProps<T> {
  label: string;
  value: T;
  onSave: SaveFn<T>;
  /** Called when a draft opens, so the save is checked against the version it started from. */
  onEdit?: () => void;
  pending: boolean;
  error: React.ReactNode;
}

/** Esc cancels the editor it is in (and nothing else, e.g. not the panel). */
function onEscape(cancel: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };
}

function SaveCancel({ pending, onCancel }: { pending: boolean; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** One line of text: click it, type, Enter or Save. */
export function InlineText({
  label,
  value,
  onSave,
  onEdit,
  pending,
  error,
  placeholder = "—",
  required = false,
  className,
  wrap = (button) => button,
}: EditorProps<string> & {
  placeholder?: string;
  required?: boolean;
  className?: string;
  /** Wraps the read view, e.g. in the page heading; the edit form renders outside it. */
  wrap?: (button: React.ReactNode) => React.ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useUnsavedDraft(draft !== null && draft.trim() !== value);
  if (draft === null)
    return (
      <>
        {wrap(
          <button
            type="button"
            aria-label={value ? undefined : `Edit ${label.toLowerCase()}`}
            title={`Edit ${label.toLowerCase()}`}
            onClick={() => {
              onEdit?.();
              setDraft(value);
            }}
            className={cn(
              "rounded-md text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
              !value && "text-muted-foreground",
              className,
            )}
          >
            {value || placeholder}
          </button>,
        )}
        {error}
      </>
    );
  return (
    <form
      className="space-y-2"
      onKeyDown={onEscape(() => setDraft(null))}
      onSubmit={(e) => {
        e.preventDefault();
        if (required && !draft.trim()) return;
        onSave(draft.trim(), () => setDraft(null));
      }}
    >
      <Input
        aria-label={label}
        autoFocus
        required={required}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      {error}
      <SaveCancel pending={pending} onCancel={() => setDraft(null)} />
    </form>
  );
}

/** The description: rendered markdown; click it (not a link) or Edit for Write / Preview. */
export function MarkdownField({
  label,
  value,
  onSave,
  onEdit,
  pending,
  error,
}: EditorProps<string>) {
  const [draft, setDraft] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  useUnsavedDraft(draft !== null && draft !== value);
  const edit = () => {
    onEdit?.();
    setPreview(false);
    setDraft(value);
  };

  if (draft === null)
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{label}</h3>
          <Button size="sm" variant="ghost" onClick={edit}>
            Edit {label.toLowerCase()}
          </Button>
        </div>
        {value ? (
          <div
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("a, button")) edit();
            }}
            className="cursor-text rounded-md hover:bg-muted/50"
          >
            <Markdown>{value}</Markdown>
          </div>
        ) : (
          <p className="text-muted-foreground">No {label.toLowerCase()} yet.</p>
        )}
        {error}
      </div>
    );

  return (
    <form
      className="space-y-2"
      onKeyDown={onEscape(() => setDraft(null))}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft, () => setDraft(null));
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{label}</h3>
        <div className="flex gap-1" role="group" aria-label="Editor mode">
          {(["Write", "Preview"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={(mode === "Preview") === preview ? "default" : "ghost"}
              aria-pressed={(mode === "Preview") === preview}
              onClick={() => setPreview(mode === "Preview")}
            >
              {mode}
            </Button>
          ))}
        </div>
      </div>
      {preview ? (
        <div className="min-h-20 rounded-md border border-border p-3" aria-label="Preview">
          {draft ? (
            <Markdown>{draft}</Markdown>
          ) : (
            <p className="text-muted-foreground">Nothing to preview.</p>
          )}
        </div>
      ) : (
        <Textarea
          aria-label={label}
          autoFocus
          className="min-h-40 font-mono text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Markdown. Links show their host; images show as links.
      </p>
      {error}
      <SaveCancel pending={pending} onCancel={() => setDraft(null)} />
    </form>
  );
}

/** A list (criteria, out of scope, touches): remove an item with ×, add one with Enter. */
export function EditableList({
  label,
  value,
  onSave,
  pending,
  error,
  ordered = false,
}: EditorProps<string[]> & { ordered?: boolean }) {
  const [draft, setDraft] = useState("");
  useUnsavedDraft(draft.trim() !== "");
  const List = ordered ? "ol" : "ul";
  return (
    <section aria-label={label} className="space-y-1">
      <h3 className="text-sm font-medium">{label}</h3>
      {value.length > 0 && (
        <List className={cn("space-y-1 pl-5", ordered ? "list-decimal" : "list-disc")}>
          {value.map((item, i) => (
            <li key={`${i}-${item}`}>
              <span className="flex items-start justify-between gap-2">
                <span className="break-words">{item}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 shrink-0 px-1 text-muted-foreground"
                  aria-label={`Remove: ${item}`}
                  disabled={pending}
                  onClick={() =>
                    onSave(
                      value.filter((_, n) => n !== i),
                      () => {},
                    )
                  }
                >
                  <X aria-hidden className="size-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </List>
      )}
      <form
        onKeyDown={onEscape(() => setDraft(""))}
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !pending) onSave([...value, draft.trim()], () => setDraft(""));
        }}
      >
        <Input
          aria-label={`Add to ${label.toLowerCase()}`}
          placeholder="Add an item, press Enter"
          // Quiet until used: a box per list would outweigh the items.
          className="h-7 border-transparent bg-transparent px-1 text-xs hover:border-border focus-visible:border-border"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
      {error}
    </section>
  );
}
