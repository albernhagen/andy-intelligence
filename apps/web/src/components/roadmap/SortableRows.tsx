import { useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { DragPreview, verticalOnly } from "@/components/DragPreview";
import { cn } from "@/lib/utils";

/**
 * A list whose rows reorder (AI-324, shared by the roadmap's milestones and the milestone page's
 * epics, AI-405): drag a row's handle (pointer, or Space and the arrow keys), or use Move up and
 * Move down. The new order shows at once while `onMove` saves it; once that settles the rows show
 * what the server holds, so a refusal puts them back (the caller shows the API's message).
 */

/** A row's Move up and Move down, or null when there is only one row, so nothing to reorder. */
export type RowReorder = {
  up: (() => void) | null;
  down: (() => void) | null;
  busy: boolean;
} | null;

export function SortableRows<T>({
  items,
  idOf,
  busy,
  onMove,
  row,
  preview,
  className,
}: {
  items: readonly T[];
  idOf: (item: T) => string;
  busy: boolean;
  /** Saves `id` at index `to` of `shown`; null when there is nothing to write. */
  onMove: (id: string, to: number, shown: readonly T[]) => Promise<unknown> | null;
  row: (item: T, reorder: RowReorder) => ReactNode;
  /** The copy drawn under the pointer while a row is dragged (AI-396). */
  preview: (item: T) => ReactNode;
  className?: string;
}) {
  const [pending, setPending] = useState<string[] | null>(null);
  // The row being dragged, and whether it is over the list (the list then takes the selected edge).
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overList, setOverList] = useState(false);
  const byId = new Map(items.map((m) => [idOf(m), m]));
  const shown = pending ? pending.flatMap((id) => byId.get(id) ?? []) : items;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const canMove = items.length > 1;
  const dragged = activeId ? byId.get(activeId) : undefined;

  function move(id: string, to: number) {
    const saving = onMove(id, to, shown);
    if (!saving) return;
    const ids = shown.map(idOf).filter((x) => x !== id);
    ids.splice(to, 0, id);
    setPending(ids);
    // The caller refetches before the promise settles, so the rows never flash the old order.
    void saving.catch(() => {}).finally(() => setPending(null));
  }

  function endDrag() {
    setActiveId(null);
    setOverList(false);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    endDrag();
    if (!over || active.id === over.id) return;
    move(
      String(active.id),
      shown.findIndex((m) => idOf(m) === over.id),
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragOver={({ over }) => setOverList(over !== null)}
      onDragCancel={endDrag}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={shown.map(idOf)} strategy={verticalListSortingStrategy}>
        <ul
          data-drop-over={overList || undefined}
          className={cn(
            "divide-y divide-border overflow-hidden rounded-lg border",
            overList ? "border-selected-edge bg-selected" : "border-border bg-raised",
            className,
          )}
        >
          {shown.map((m, i) =>
            row(
              m,
              canMove
                ? {
                    up: i > 0 ? () => move(idOf(m), i - 1) : null,
                    down: i < shown.length - 1 ? () => move(idOf(m), i + 1) : null,
                    busy,
                  }
                : null,
            ),
          )}
        </ul>
      </SortableContext>
      <DragPreview modifiers={[verticalOnly]}>{dragged ? preview(dragged) : null}</DragPreview>
    </DndContext>
  );
}

export interface SortableRow {
  ref: (node: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  handle: {
    ref: (node: HTMLElement | null) => void;
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners;
  };
}

/** One row's place in a `SortableRows` list: vertical moves only. */
export function useSortableRow(id: string, reorder: RowReorder): SortableRow {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !reorder || reorder.busy });
  return {
    ref: setNodeRef,
    style: { transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition },
    isDragging,
    handle: { ref: setActivatorNodeRef, attributes, listeners },
  };
}

const MOVE_BUTTON =
  "inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 sm:size-7";

/** A row's drag handle (hidden on a phone, where it would crowd the row), Move up and Move down. */
export function ReorderControls({
  name,
  reorder,
  handle,
}: {
  name: string;
  reorder: NonNullable<RowReorder>;
  handle: SortableRow["handle"];
}) {
  return (
    <div role="group" aria-label={`Order of ${name}`} className="flex items-center pl-1 pt-0.5">
      <button
        type="button"
        ref={handle.ref}
        {...handle.attributes}
        {...handle.listeners}
        aria-label={`Drag ${name} to reorder`}
        className={`${MOVE_BUTTON} cursor-grab max-sm:hidden`}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`Move ${name} up`}
        disabled={!reorder.up || reorder.busy}
        onClick={() => reorder.up?.()}
        className={MOVE_BUTTON}
      >
        <ArrowUp className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`Move ${name} down`}
        disabled={!reorder.down || reorder.busy}
        onClick={() => reorder.down?.()}
        className={MOVE_BUTTON}
      >
        <ArrowDown className="size-4" aria-hidden />
      </button>
    </div>
  );
}
