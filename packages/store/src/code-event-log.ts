import { Timestamp, type Firestore } from "@google-cloud/firestore";
import { CodeHostEvent, DeliveryId, type CodeEventLog, type RecordResult } from "@andy/contracts";
import { SCHEMA_VERSION, collections } from "./index";

/** Firestore TTL policy field (Terraform `code_host_event_ttl`). */
export const CODE_HOST_EVENT_TTL_FIELD = "ttl";
/** Records are kept 30 days (ADR-0028: bounded storage); later slices act on them sooner. */
export const CODE_HOST_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** gRPC ALREADY_EXISTS: `create()` on a document that exists. */
const ALREADY_EXISTS = 6;

/**
 * CodeEventLog on Firestore. One document per delivery, keyed by delivery ID; `create()` fails
 * if the document exists, which makes recording atomic and idempotent without a transaction.
 */
export class FirestoreCodeEventLog implements CodeEventLog {
  constructor(private readonly db: Firestore) {}

  private doc(deliveryId: string) {
    return this.db.collection(collections.codeHostEvents.path()).doc(deliveryId);
  }

  async record(event: CodeHostEvent): Promise<RecordResult> {
    const parsed = CodeHostEvent.parse(event);
    const expires = Date.parse(parsed.receivedAt) + CODE_HOST_EVENT_RETENTION_MS;
    try {
      await this.doc(parsed.deliveryId).create({
        ...parsed,
        _v: SCHEMA_VERSION,
        [CODE_HOST_EVENT_TTL_FIELD]: Timestamp.fromMillis(expires),
      });
      return "recorded";
    } catch (err) {
      if ((err as { code?: number }).code === ALREADY_EXISTS) return "duplicate";
      throw err;
    }
  }

  async get(deliveryId: string): Promise<CodeHostEvent | null> {
    if (!DeliveryId.safeParse(deliveryId).success) return null;
    const data = (await this.doc(deliveryId).get()).data();
    // Zod drops the storage-only fields (`_v`, `ttl`).
    return data ? CodeHostEvent.parse(data) : null;
  }
}
