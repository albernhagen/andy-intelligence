import { useSyncExternalStore } from "react";

/** Below Tailwind's `sm` breakpoint (40rem): the phone layout (design.md "Phone"). */
export const PHONE_QUERY = "(max-width: 39.99rem)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const list = window.matchMedia(PHONE_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

const snapshot = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(PHONE_QUERY).matches;

/**
 * True on a phone-width screen. Used where the phone needs different elements, not just
 * different classes (the bottom navigation); without `matchMedia` (jsdom) it is false.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
