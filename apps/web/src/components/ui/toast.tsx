import { useSyncExternalStore } from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Toast on Radix (AI-369). After a write succeeds, any screen calls
 * `toast({ title: "Answered AI-3", undo: () => revert() })`; `<Toaster />` (mounted once in
 * main.tsx) shows it. Undo appears only when the caller passes `undo`, i.e. when the write can
 * be reversed. A failed undo shows the error as a toast of its own, never silently.
 */

export interface ToastInput {
  /** What happened, where: "Answered AI-3: Pick a worker". */
  title: string;
  description?: string;
  /** Reverses the write. Given: the toast shows Undo. */
  undo?: () => void | Promise<void>;
  tone?: "default" | "destructive";
}

interface ToastItem extends ToastInput {
  id: number;
}

/** At most this many toasts at once; the oldest goes first. */
export const MAX_TOASTS = 3;
/** How long a toast stays: long enough to reach Undo. Hover or focus pauses it (Radix). */
export const TOAST_DURATION_MS = 6000;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(next: ToastItem[]) {
  items = next;
  for (const l of listeners) l();
}

/** Shows a toast; returns its id for `dismissToast`. */
export function toast(input: ToastInput): number {
  const id = nextId++;
  emit([...items, { ...input, id }].slice(-MAX_TOASTS));
  return id;
}

export function dismissToast(id: number) {
  emit(items.filter((t) => t.id !== id));
}

/** Test seam: clears every toast. */
export function resetToasts() {
  emit([]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function runUndo(item: ToastItem) {
  dismissToast(item.id);
  try {
    await item.undo?.();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("toast: undo failed", err);
    toast({ title: "Couldn't undo", description: message, tone: "destructive" });
  }
}

export function Toaster() {
  const current = useSyncExternalStore(subscribe, () => items);
  return (
    <ToastPrimitive.Provider duration={TOAST_DURATION_MS} label="Notifications">
      {current.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          onOpenChange={(open) => {
            if (!open) dismissToast(item.id);
          }}
          className={cn(
            "pointer-events-auto flex animate-enter items-start gap-2 rounded-lg border border-border bg-raised p-3 text-sm text-foreground shadow-md",
            item.tone === "destructive" && "border-destructive/40",
          )}
        >
          <div className="grid min-w-0 flex-1 gap-0.5 py-1">
            <ToastPrimitive.Title
              className={cn("font-medium", item.tone === "destructive" && "text-destructive")}
            >
              {item.title}
            </ToastPrimitive.Title>
            {item.description && (
              <ToastPrimitive.Description className="text-muted-foreground">
                {item.description}
              </ToastPrimitive.Description>
            )}
          </div>
          {item.undo && (
            <ToastPrimitive.Action
              altText="Undo the last change"
              onClick={(e) => {
                // Radix would close the toast itself; runUndo dismisses it and reports a failure.
                e.preventDefault();
                void runUndo(item);
              }}
              className="inline-flex h-11 shrink-0 items-center rounded-md px-3 font-medium text-foreground hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring sm:h-8"
            >
              Undo
            </ToastPrimitive.Action>
          )}
          <ToastPrimitive.Close
            aria-label="Dismiss"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:size-8"
          >
            <X aria-hidden className="size-4" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      {/* Above the phone's bottom bar; bottom right on wider screens. The empty viewport lets
          clicks through to the page. */}
      <ToastPrimitive.Viewport className="fixed right-0 bottom-[calc(env(safe-area-inset-bottom)+4rem)] pointer-events-none z-[60] flex w-full flex-col gap-2 p-4 outline-none sm:bottom-0 sm:max-w-sm" />
    </ToastPrimitive.Provider>
  );
}
