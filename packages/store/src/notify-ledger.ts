import type { Firestore } from "@google-cloud/firestore";
import { EmailNotifyState, type NotifyLedger } from "@andy/contracts";
import { collections, zodConverter } from "./index";

/**
 * NotifyLedger on Firestore (AI-77): one document, `config/{docId}`, updated in a transaction
 * so two instances can't both send the day's last email.
 */
export class FirestoreNotifyLedger implements NotifyLedger {
  constructor(
    private readonly db: Firestore,
    /** Test seam: the emulator suite gives each test its own document. */
    private readonly docId = "emailNotify",
  ) {}

  private doc() {
    return this.db
      .collection(collections.config.path())
      .withConverter(zodConverter(EmailNotifyState))
      .doc(this.docId);
  }

  async get(): Promise<EmailNotifyState | null> {
    return (await this.doc().get()).data() ?? null;
  }

  async update<T>(
    change: (state: EmailNotifyState | null) => { state: EmailNotifyState; result: T },
  ): Promise<T> {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.doc());
      const { state, result } = change(snap.data() ?? null);
      tx.set(this.doc(), EmailNotifyState.parse(state));
      return result;
    });
  }
}
