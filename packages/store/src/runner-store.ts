import type { Firestore } from "@google-cloud/firestore";
import {
  Runner,
  RunTokenGrant,
  WorkTrackerError,
  runnerIsActive,
  type NewRunnerRecord,
  type RunnerStore,
} from "@andy/contracts";
import { z } from "zod";
import { SCHEMA_VERSION, collections } from "./index";

/** A runner document: the runner plus its secret's hash, which reads never return. */
const RunnerRecord = Runner.extend({ secretHash: z.string().min(1) });

/**
 * RunnerStore on Firestore (ADR-0089). `runners/{id}` holds each runner with its secret's hash;
 * `runTokens/{hash}` binds a per-run token to its run. The cap and the claim interval are
 * checked inside transactions, so concurrent mints or claims can't both pass. Expired run
 * tokens read as missing; they are a few small documents per run, never read again.
 */
export class FirestoreRunnerStore implements RunnerStore {
  constructor(
    private readonly db: Firestore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private runners() {
    return this.db.collection(collections.runners.path());
  }

  private tokens() {
    return this.db.collection(collections.runTokens.path());
  }

  async create(record: NewRunnerRecord, maxActive: number, now: Date): Promise<Runner> {
    const parsed = RunnerRecord.parse({ ...record.runner, secretHash: record.secretHash });
    return this.db.runTransaction(async (tx) => {
      const all = await tx.get(this.runners());
      const active = all.docs.filter((d) => runnerIsActive(RunnerRecord.parse(d.data()), now));
      if (active.length >= maxActive) {
        throw new WorkTrackerError("conflict", `at most ${maxActive} active runners`);
      }
      tx.create(this.runners().doc(parsed.id), { ...parsed, _v: SCHEMA_VERSION });
      return Runner.parse(parsed);
    });
  }

  async get(runnerId: string): Promise<Runner | null> {
    const snap = await this.runners().doc(runnerId).get();
    return snap.exists ? toRunner(snap.data()) : null;
  }

  async list(): Promise<Runner[]> {
    const snap = await this.runners().get();
    return snap.docs
      .map((d) => toRunner(d.data()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  async findBySecretHash(secretHash: string): Promise<Runner | null> {
    const snap = await this.runners().where("secretHash", "==", secretHash).limit(1).get();
    const doc = snap.docs[0];
    return doc ? toRunner(doc.data()) : null;
  }

  async revoke(runnerId: string, at: string): Promise<Runner> {
    const ref = this.runners().doc(runnerId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new WorkTrackerError("not_found", `runner ${runnerId} not found`);
      const current = toRunner(snap.data());
      if (current.revokedAt !== null) return current;
      tx.update(ref, { revokedAt: at });
      return { ...current, revokedAt: at };
    });
  }

  async recordClaim(
    runnerId: string,
    at: string,
    minIntervalMs: number,
  ): Promise<"ok" | "too_soon"> {
    const ref = this.runners().doc(runnerId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new WorkTrackerError("not_found", `runner ${runnerId} not found`);
      const last = toRunner(snap.data()).lastSeenAt;
      if (last && Date.parse(at) - Date.parse(last) < minIntervalMs) return "too_soon";
      tx.update(ref, { lastSeenAt: at });
      return "ok";
    });
  }

  async putRunToken(tokenHash: string, grant: RunTokenGrant): Promise<void> {
    await this.tokens()
      .doc(tokenHash)
      .set({ ...RunTokenGrant.parse(grant), _v: SCHEMA_VERSION });
  }

  async getRunToken(tokenHash: string): Promise<RunTokenGrant | null> {
    const data = (await this.tokens().doc(tokenHash).get()).data();
    if (!data) return null;
    const { _v, ...rest } = data;
    void _v;
    const grant = RunTokenGrant.parse(rest);
    return Date.parse(grant.expiresAt) <= this.now().getTime() ? null : grant;
  }
}

function toRunner(data: Record<string, unknown> | undefined): Runner {
  const { secretHash, _v, ...rest } = data ?? {};
  void secretHash;
  void _v;
  return Runner.parse(rest);
}
