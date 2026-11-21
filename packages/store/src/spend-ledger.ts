import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "@google-cloud/firestore";
import { z } from "zod";
import {
  MicroUsd,
  SpendCapLimits,
  SpendEntry,
  WorkTrackerError,
  sameSpendReservation,
  spendCapPassed,
  spendCounted,
  type ReserveOutcome,
  type SpendLedger,
  type SpendTotals,
} from "@andy/contracts";
import { typedCollection } from "./index";

/**
 * SpendLedger on Firestore (AI-247: M10.6), server-only (the rules deny every client read and
 * write). Entries live in `spend/{sha256(id)}`; running totals in `spendTotals/{scope}|{window}`,
 * one document per scope (`global`, or `project:<id>`) and UTC window (`day:YYYY-MM-DD`,
 * `month:YYYY-MM`). `reserve`, `settle` and `release` read the entry and its four totals and
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

/** The total document ids an entry reserved at `at` for `projectId` counts in. */
export function spendTotalDocIds(projectId: string, at: string) {
  const project = scopeOf(projectId);
  return {
    projectDay: `${project}|day:${dayOf(at)}`,
    projectMonth: `${project}|month:${monthOf(at)}`,
    globalDay: `global|day:${dayOf(at)}`,
    globalMonth: `global|month:${monthOf(at)}`,
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

  /** Reads an entry's four totals inside `tx`; a missing document is zero. */
  private async readTotals(tx: Transaction, projectId: string, at: string) {
    const ids = spendTotalDocIds(projectId, at);
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
      const totals = await this.readTotals(tx, parsed.projectId, parsed.at);
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
    const s = scopeOf(scope.projectId);
    const [day, month] = await this.db.getAll(
      this.totalsCol().doc(`${s}|day:${dayOf(at)}`),
      this.totalsCol().doc(`${s}|month:${monthOf(at)}`),
    );
    return {
      day: dayOf(at),
      dayMicroUsd: day!.data()?.microUsd ?? 0,
      month: monthOf(at),
      monthMicroUsd: month!.data()?.microUsd ?? 0,
    };
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
      const totals = await this.readTotals(tx, e.projectId, e.at);
      if (e.state !== "reserved") return e;
      const next = SpendEntry.parse({ ...change(e), settledAt: at });
      tx.set(ref, next);
      this.writeTotals(tx, totals, spendCounted(next) - spendCounted(e));
      return next;
    });
  }
}
