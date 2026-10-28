import {
  Firestore,
  type CollectionReference,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from "@google-cloud/firestore";
import {
  ConfigChange,
  Model,
  Policy,
  Project,
  Provider,
  QuotaReading,
  Question,
  Release,
  Run,
  Ticket,
  TicketEvent,
  Tier,
} from "@andy/contracts";
import type { z } from "zod";

/**
 * Firestore persistence (ADR-0017). Documents are validated with the same Zod schemas
 * as the API, so contracts stay the single schema definition; there are no migrations.
 * Each document carries `_v` (schema version) so readers can upgrade old shapes lazily.
 */

export const SCHEMA_VERSION = 1;

/** Collection layout. Tickets and their history live under their project. */
export const collections = {
  projects: { path: () => "projects", schema: Project },
  tickets: { path: (projectId: string) => `projects/${projectId}/tickets`, schema: Ticket },
  ticketEvents: {
    path: (projectId: string, ticketId: string) =>
      `projects/${projectId}/tickets/${ticketId}/events`,
    schema: TicketEvent,
  },
  questions: { path: () => "questions", schema: Question },
  runs: { path: () => "runs", schema: Run },
  providers: { path: () => "providers", schema: Provider },
  models: { path: () => "models", schema: Model },
  tiers: { path: () => "tiers", schema: Tier },
  policies: { path: () => "policies", schema: Policy },
  quotaReadings: { path: () => "quotaReadings", schema: QuotaReading },
  configChanges: { path: () => "configChanges", schema: ConfigChange },
  releases: { path: () => "releases", schema: Release },
} as const;

/** Zod-validated converter: rejects malformed documents on read and write. */
export function zodConverter<S extends z.ZodType<DocumentData>>(
  schema: S,
): FirestoreDataConverter<z.infer<S>> {
  return {
    toFirestore(value) {
      return { ...schema.parse(value), _v: SCHEMA_VERSION };
    },
    fromFirestore(snapshot: QueryDocumentSnapshot) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _v, ...data } = snapshot.data();
      return schema.parse(data);
    },
  };
}

export function createFirestore(projectId: string): Firestore {
  // Application Default Credentials: the Cloud Run runtime SA in prod, your gcloud login locally.
  // Set FIRESTORE_EMULATOR_HOST to use the emulator.
  return new Firestore({ projectId, ignoreUndefinedProperties: true });
}

export function typedCollection<S extends z.ZodType<DocumentData>>(
  db: Firestore,
  path: string,
  schema: S,
): CollectionReference<z.infer<S>> {
  return db.collection(path).withConverter(zodConverter(schema));
}
