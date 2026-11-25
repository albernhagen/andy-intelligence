import { vi } from "vitest";
import { PHONE_QUERY } from "@/lib/use-phone";

/** Makes `useIsPhone` answer `phone` (jsdom has no `matchMedia`); undo with `vi.unstubAllGlobals`. */
export function emulateWidth(phone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: phone && query === PHONE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}
