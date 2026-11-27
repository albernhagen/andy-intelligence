/**
 * For tests that fake the board's layout: the dragged copy (AI-396, `[data-drag-overlay]` inside
 * dnd-kit's overlay wrapper) starts where its card is, so it measures as that card. Returns the
 * card to measure instead of `el`, or null when `el` isn't part of the copy.
 */
export function dragCopySource(el: Element): Element | null {
  if (!el.closest("[data-drag-overlay]") && !el.querySelector(":scope > [data-drag-overlay]"))
    return null;
  return document.querySelector("[data-dragging]");
}
