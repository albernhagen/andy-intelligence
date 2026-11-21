import {
  SpendCapLimits,
  SpendEntry,
  spendCapPassed,
  spendCounted,
  type SpendTotals,
} from "../entities/spend";
import { WorkTrackerError } from "../ports";
import { sameSpendReservation, type ReserveOutcome, type SpendLedger } from "../ports/spend";

const dayOf = (at: string) => new Date(at).toISOString().slice(0, 10);
const monthOf = (at: string) => new Date(at).toISOString().slice(0, 7);

/** In-memory SpendLedger: each call runs synchronously, so reserve is atomic in one process. */
export class InMemorySpendLedger implements SpendLedger {
  private readonly entries = new Map<string, SpendEntry>();

  async reserve(entry: SpendEntry, caps: SpendCapLimits): Promise<ReserveOutcome> {
    const parsed = SpendEntry.parse(entry);
    const limits = SpendCapLimits.parse(caps);
    if (parsed.state !== "reserved" || parsed.settledMicroUsd !== null || parsed.settledAt) {
      throw new Error("a new spend entry must be reserved, not settled");
    }
    const existing = this.entries.get(parsed.id);
    if (existing) {
      if (!sameSpendReservation(existing, parsed)) {
        throw new WorkTrackerError("conflict", `spend entry ${parsed.id} exists with other terms`);
      }
      return { ok: true, entry: structuredClone(existing) };
    }
    const passed = spendCapPassed(
      parsed.reservedMicroUsd,
      limits,
      this.sum(parsed.at, parsed.projectId),
      this.sum(parsed.at),
    );
    if (passed) return { ok: false, ...passed };
    this.entries.set(parsed.id, parsed);
    return { ok: true, entry: structuredClone(parsed) };
  }

  async settle(id: string, microUsd: number | null, at: string): Promise<SpendEntry | null> {
    return this.close(id, at, (e) => ({
      ...e,
      state: "settled",
      settledMicroUsd: microUsd ?? e.reservedMicroUsd,
    }));
  }

  async release(id: string, at: string): Promise<SpendEntry | null> {
    return this.close(id, at, (e) => ({ ...e, state: "released" }));
  }

  async get(id: string): Promise<SpendEntry | null> {
    const e = this.entries.get(id);
    return e ? structuredClone(e) : null;
  }

  async totals(scope: { projectId?: string }, at: string): Promise<SpendTotals> {
    const { dayMicroUsd, monthMicroUsd } = this.sum(at, scope.projectId);
    return { day: dayOf(at), dayMicroUsd, month: monthOf(at), monthMicroUsd };
  }

  private close(id: string, at: string, change: (e: SpendEntry) => SpendEntry): SpendEntry | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.state !== "reserved") return structuredClone(e);
    const next = SpendEntry.parse({ ...change(e), settledAt: at });
    this.entries.set(id, next);
    return structuredClone(next);
  }

  private sum(at: string, projectId?: string) {
    let dayMicroUsd = 0;
    let monthMicroUsd = 0;
    for (const e of this.entries.values()) {
      if (projectId !== undefined && e.projectId !== projectId) continue;
      if (monthOf(e.at) !== monthOf(at)) continue;
      monthMicroUsd += spendCounted(e);
      if (dayOf(e.at) === dayOf(at)) dayMicroUsd += spendCounted(e);
    }
    return { dayMicroUsd, monthMicroUsd };
  }
}
