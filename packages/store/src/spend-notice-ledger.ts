import type { Firestore } from "@google-cloud/firestore";
import { SpendNoticeState, type SpendNoticeLedger } from "@andy/contracts";
import { collections, zodConverter } from "./index";

/**
 * SpendNoticeLedger on Firestore (AI-257: M10.9): one document, `config/{docId}`, updated in a
 * transaction so two instances can't both send the same spend notice or pass the daily cap.
 * Server-only (the rules deny every client read and write).
 */
export class FirestoreSpendNoticeLedger implements SpendNoticeLedger {
  constructor(
    private readonly db: Firestore,
    /** Test seam: the emulator suite gives each test its own document. */
    private readonly docId = "spendNotices",
  ) {}

  private doc() {
    return this.db
      .collection(collections.config.path())
      .withConverter(zodConverter(SpendNoticeState))
      .doc(this.docId);
  }

  async get(): Promise<SpendNoticeState | null> {
    return (await this.doc().get()).data() ?? null;
  }

  async update<T>(
    change: (state: SpendNoticeState | null) => { state: SpendNoticeState; result: T },
  ): Promise<T> {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.doc());
      const { state, result } = change(snap.data() ?? null);
      tx.set(this.doc(), SpendNoticeState.parse(state));
      return result;
    });
  }
}
