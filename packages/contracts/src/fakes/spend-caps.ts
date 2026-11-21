import { SpendCaps, StoredSpendCaps, nextSpendCapsStamp } from "../entities/spend-caps";
import { WorkTrackerError } from "../ports";
import type { SpendCapsStore } from "../ports/spend-caps";

/**
 * In-memory SpendCapsStore. Each method reads and writes without an await in between, so
 * concurrent puts are atomic in one process, like the real store's transaction.
 */
export class InMemorySpendCapsStore implements SpendCapsStore {
  private global: StoredSpendCaps | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async getGlobal(): Promise<StoredSpendCaps | null> {
    return this.global ? structuredClone(this.global) : null;
  }

  async putGlobal(caps: SpendCaps, ifUpdatedAt: string | null): Promise<StoredSpendCaps> {
    const parsed = SpendCaps.parse(caps);
    const current = this.global?.updatedAt ?? null;
    if (current !== ifUpdatedAt) {
      throw new WorkTrackerError("conflict", "the global spend caps changed since they were read");
    }
    this.global = StoredSpendCaps.parse({
      ...parsed,
      updatedAt: nextSpendCapsStamp(current, this.now()),
    });
    return structuredClone(this.global);
  }
}
