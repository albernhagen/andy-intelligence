import type { SpendCaps, StoredSpendCaps } from "../entities/spend-caps";

// ── SpendCapsStore ───────────────────────────────────────────────────────────
// The global spend caps (AI-276; ADR-0129: "a global document plus project fields"). One
// document; each project's own caps stay on the project (AI-249). Storage only: who may edit them
// and what each change records live in @andy/domain. Errors are WorkTrackerError (`conflict`),
// mapped the same way by the API; any other failure throws, and callers fail closed.

export interface SpendCapsStore {
  /** The stored global caps, or null while none are stored (callers use the defaults). */
  getGlobal(): Promise<StoredSpendCaps | null>;
  /**
   * Stores the global caps and stamps `updatedAt` (always later than the one it replaces).
   * `ifUpdatedAt` is the `updatedAt` the caller read, null when none was stored; anything else is
   * stale and refused with `conflict`, and nothing is written.
   */
  putGlobal(caps: SpendCaps, ifUpdatedAt: string | null): Promise<StoredSpendCaps>;
}
