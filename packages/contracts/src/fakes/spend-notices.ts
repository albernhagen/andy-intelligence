import { SpendNoticeState } from "../entities/spend-notices";
import type { SpendNoticeLedger } from "../ports/spend-notices";

/** In-memory SpendNoticeLedger: one state, updated synchronously (so atomically) in one process. */
export class InMemorySpendNoticeLedger implements SpendNoticeLedger {
  private state: SpendNoticeState | null = null;

  async get(): Promise<SpendNoticeState | null> {
    return this.state ? structuredClone(this.state) : null;
  }

  async update<T>(
    change: (state: SpendNoticeState | null) => { state: SpendNoticeState; result: T },
  ): Promise<T> {
    const { state, result } = change(this.state ? structuredClone(this.state) : null);
    this.state = SpendNoticeState.parse(state);
    return result;
  }
}
