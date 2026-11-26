import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DragOverlay, type DropAnimation, type Modifier } from "@dnd-kit/core";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * How cards slide aside while one is dragged and settle on drop (design.md "Motion"): the base
 * duration and the standard easing. index.css turns it off under `prefers-reduced-motion`.
 */
export const MOVE_TRANSITION = { duration: 150, easing: "cubic-bezier(0.2, 0, 0, 1)" };

/**
 * The copy settling into its slot on drop (design.md "Motion"): the base duration and standard
 * easing, well under the 200 ms in which the copy must be gone (AI-396).
 */
export const DROP_ANIMATION = { ...MOVE_TRANSITION } satisfies DropAnimation;

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const list = window.matchMedia(REDUCED_MOTION);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

const snapshot = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED_MOTION).matches;

/**
 * No drop animation under `prefers-reduced-motion` (index.css only stops CSS transitions; dnd-kit
 * animates with the Web Animations API) or where that API is missing (jsdom): the copy just goes.
 */
export function useDropAnimation(): DropAnimation | null {
  const reduced = useSyncExternalStore(subscribe, snapshot, () => false);
  const canAnimate = typeof Element !== "undefined" && "animate" in Element.prototype;
  return reduced || !canAnimate ? null : DROP_ANIMATION;
}

/** Keeps a copy in its column: the roadmap's rows only move up and down. */
export const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** How a dragged copy looks: lifted above the page with the selected edge (design.md). */
export const DRAG_PREVIEW_CLASS = "cursor-grabbing border-selected-edge shadow-md";

/**
 * The dragged item drawn under the pointer (AI-396), rendered into `body` so a scrolling lane or a
 * clipped list can't hide it. `children` is the copy, or null when nothing is dragged.
 */
export function DragPreview({
  children,
  modifiers,
}: {
  children: ReactNode;
  /** E.g. `[verticalOnly]` for a list that only reorders up and down. */
  modifiers?: Modifier[];
}) {
  const dropAnimation = useDropAnimation();
  return createPortal(
    <DragOverlay dropAnimation={dropAnimation} modifiers={modifiers}>
      {children}
    </DragOverlay>,
    document.body,
  );
}
