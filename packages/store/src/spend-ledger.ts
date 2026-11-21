import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "@google-cloud/firestore";
import { z } from "zod";
import {
  MicroUsd,
  ProviderKey,
  SpendCapLimits,
  SpendEntry,
  WorkTrackerError,
  sameSpendReservation,
  spendCapPassed,
  spendCounted,
  type ProviderSpendTotals,
  type ReserveOutcome,
  type SpendLedger,
  type SpendTotals,
} from "@andy/contracts";
import { typedCollection } from "./index";

/**
 * SpendLedger on Firestore (AI-247: M10.6), server-only (the rules deny every client read and
 * write). Entries live in `spend/{sha256(id)}`; running totals in `spendTotals/{scope}|{window}`,
 * one document per scope (`global`, or `project:<id>`) and UTC window (`day:YYYY-MM-DD`,
 * `month:YYYY-MM`), and the same split by provider (`{scope}|provider:<key>|{window}`, AI-280).
 * `reserve`, `settle` and `release` read the entry and its eight totals and
 * write them in one transaction, so concurrent reservations can't pass a cap together and a read
 * is a fixed number of documents, never a scan (ADR-0126). A missing total is zero; a total
 * that can't be read or doesn't parse fails the call, so nothing is recorded (fails closed).
 */

export const SPEND_COLLECTION = "spend";
export const SPEND_TOTALS_COLLECTION = "spendTotals";

/** One running total: what its scope's entries count in its window. */
export const SpendTotalDoc = z.object({ microUsd: MicroUsd });
export type SpendTotalDoc = z.infer<typeof SpendTotalDoc>;

/** Entry ids are free-form, so their document id is a hash (no `/`, never `.` or `..`). */
export const spendEntryDocId = (id: string) => createHash("sha256").update(id).digest("hex");

const dayOf = (at: string) => new Date(at).toISOString().slice(0, 10);
const monthOf = (at: string) => new Date(at).toISOString().slice(0, 7);
const scopeOf = (projectId?: string) =>
  projectId === undefined ? "global" : `project:${encodeURIComponent(projectId)}`;

/**
 * The one way a total document id is built (reads and writes both use it, so they can't drift):
 * `{scope}|{window}` or, split by provider (AI-280), `{scope}|provider:<key>|{window}`.
 */
export function spendTotalDocId(
  scope: { projectId?: string; provider?: string },
  window: "day" | "month",
  at: string,
): string {
  const w = window === "day" ? `day:${dayOf(at)}` : `month:${monthOf(at)}`;
  const p = scope.provider === undefined ? "" : `provider:${encodeURIComponent(scope.provider)}|`;
  return `${scopeOf(scope.projectId)}|${p}${w}`;
}

/**
 * The total document ids an entry reserved at `at` for `projectId` on `provider` counts in: the
 * project's and the global totals, and the same two split by provider (AI-280).
 */
export function spendTotalDocIds(projectId: string, at: string, provider: string) {
  return {
    projectDay: spendTotalDocId({ projectId }, "day", at),
    projectMonth: spendTotalDocId({ projectId }, "month", at),
    globalDay: spendTotalDocId({}, "day", at),
    globalMonth: spendTotalDocId({}, "month", at),
    projectProviderDay: spendTotalDocId({ projectId, provider }, "day", at),
    projectProviderMonth: spendTotalDocId({ projectId, provider }, "month", at),
    globalProviderDay: spendTotalDocId({ provider }, "day", at),
    globalProviderMonth: spendTotalDocId({ provider }, "month", at),
  };
}

type TotalKey = keyof ReturnType<typeof spendTotalDocIds>;

export class FirestoreSpendLedger implements SpendLedger {
  constructor(private readonly db: Firestore) {}

  private entries() {
    return typedCollection(this.db, SPEND_COLLECTION, SpendEntry);
  }

  private totalsCol() {
    return typedCollection(this.db, SPEND_TOTALS_COLLECTION, SpendTotalDoc);
  }

  /** Reads an entry's eight totals inside `tx`; a missing document is zero. */
  private async readTotals(tx: Transaction, entry: SpendEntry) {
    const ids = spendTotalDocIds(entry.projectId, entry.at, entry.provider);
    const keys = Object.keys(ids) as TotalKey[];
    const snaps = await tx.getAll(...keys.map((k) => this.totalsCol().doc(ids[k])));
    const values = Object.fromEntries(
      keys.map((k, i) => [k, snaps[i]!.data()?.microUsd ?? 0]),
    ) as Record<TotalKey, number>;
    return { ids, values };
  }

  private writeTotals(
    tx: Transaction,
    totals: Awaited<ReturnType<FirestoreSpendLedger["readTotals"]>>,
    delta: number,
  ) {
    for (const k of Object.keys(totals.ids) as TotalKey[]) {
      tx.set(this.totalsCol().doc(totals.ids[k]), { microUsd: totals.values[k] + delta });
    }
  }

  async reserve(entry: SpendEntry, caps: SpendCapLimits): Promise<ReserveOutcome> {
    const parsed = SpendEntry.parse(entry);
    const limits = SpendCapLimits.parse(caps);
    if (parsed.state !== "reserved" || parsed.settledMicroUsd !== null || parsed.settledAt) {
      throw new Error("a new spend entry must be reserved, not settled");
    }
    const ref = this.entries().doc(spendEntryDocId(parsed.id));
    return this.db.runTransaction(async (tx): Promise<ReserveOutcome> => {
      // Every read before any write, as Firestore transactions require.
      const existing = (await tx.get(ref)).data();
      const totals = await this.readTotals(tx, parsed);
      if (existing) {
        if (!sameSpendReservation(existing, parsed)) {
          throw new WorkTrackerError(
            "conflict",
            `spend entry ${parsed.id} exists with other terms`,
          );
        }
        return { ok: true, entry: existing };
      }
      const v = totals.values;
      const passed = spendCapPassed(
        parsed.reservedMicroUsd,
        limits,
        { dayMicroUsd: v.projectDay, monthMicroUsd: v.projectMonth },
        { dayMicroUsd: v.globalDay, monthMicroUsd: v.globalMonth },
      );
      if (passed) return { ok: false, ...passed };
      tx.create(ref, parsed);
      this.writeTotals(tx, totals, parsed.reservedMicroUsd);
      return { ok: true, entry: parsed };
    });
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
    return (await this.entries().doc(spendEntryDocId(id)).get()).data() ?? null;
  }

  async totals(scope: { projectId?: string }, at: string): Promise<SpendTotals> {
    const [day, month] = await this.db.getAll(
      this.totalsCol().doc(spendTotalDocId(scope, "day", at)),
      this.totalsCol().doc(spendTotalDocId(scope, "month", at)),
    );
    return {
      day: dayOf(at),
      dayMicroUsd: day!.data()?.microUsd ?? 0,
      month: monthOf(at),
      monthMicroUsd: month!.data()?.microUsd ?? 0,
    };
  }

  async totalsByProvider(
    scope: { projectId?: string },
    at: string,
  ): Promise<ProviderSpendTotals[]> {
    const providers = ProviderKey.options;
    const snaps = await this.db.getAll(
      ...providers.flatMap((provider) => [
        this.totalsCol().doc(spendTotalDocId({ projectId: scope.projectId, provider }, "day", at)),
        this.totalsCol().doc(
          spendTotalDocId({ projectId: scope.projectId, provider }, "month", at),
        ),
      ]),
    );
    return providers.map((provider, i) => ({
      provider,
      day: dayOf(at),
      dayMicroUsd: snaps[2 * i]!.data()?.microUsd ?? 0,
      month: monthOf(at),
      monthMicroUsd: snaps[2 * i + 1]!.data()?.microUsd ?? 0,
    }));
  }

  /** Moves a reserved entry to settled or released and adjusts its totals by the difference. */
  private async close(
    id: string,
    at: string,
    change: (e: SpendEntry) => SpendEntry,
  ): Promise<SpendEntry | null> {
    const ref = this.entries().doc(spendEntryDocId(id));
    return this.db.runTransaction(async (tx) => {
      const e = (await tx.get(ref)).data();
      if (!e) return null;
      const totals = await this.readTotals(tx, e);
      if (e.state !== "reserved") return e;
      const next = SpendEntry.parse({ ...change(e), settledAt: at });
      tx.set(ref, next);
      this.writeTotals(tx, totals, spendCounted(next) - spendCounted(e));
      return next;
    });
  }
}
