import { afterAll, beforeAll } from "vitest";

/**
 * jsdom has no ResizeObserver; Radix Switch and RadioGroup measure themselves with it (AI-376:
 * the Models page). Not in the shared setup: Recharts' tests rely on it being absent. Call at the
 * top of a test file that renders those controls.
 */
export function stubResizeObserver() {
  let added = false;
  beforeAll(() => {
    if ("ResizeObserver" in globalThis) return;
    added = true;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });
  afterAll(() => {
    if (added) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });
}
