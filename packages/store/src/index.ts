import {
  Firestore,
  type CollectionReference,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from "@google-cloud/firestore";
import {
  CodeHostEvent,
  ConfigChange,
  ProposalLookupCursor,
  Model,
  OAuthGrant,
  Policy,
  Project,
  Provider,
  PushSendState,
  PushSettings,
  PushSubscription,
  QuotaClear,
  QuotaReading,
  Question,
  DigestSummary,
  Milestone,
  Release,
  ReleaseNote,
  Run,
  Ticket,
  TicketEvent,
  Tier,
} from "@andy/contracts";
import type { z } from "zod";
import { ticketEventV2toV3, ticketV1toV2, ticketV2toV3, upgrade, type Upgrader } from "./upgrade";

/**
 * Firestore persistence (ADR-0017). Documents are validated with the same Zod schemas
 * as the API, so contracts stay the single schema definition; there are no migrations.
 * Each document carries `_v` (schema version) so readers can upgrade old shapes lazily.
 */

/**
 * v2: ticket model v2 (ADR-0058), upgraded on read by `ticketV1toV2`. v3: no Monitoring stage
 * (ADR-0069): tickets and their `stage_changed` events read it as Done (`ticketV2toV3`,
 * `ticketEventV2toV3`). Other collections have nothing to upgrade.
 */
export const SCHEMA_VERSION = 3;

/** Collection layout. Tickets and their history live under their project. */
export const collections = {
  projects: { path: () => "projects", schema: Project },
  tickets: {
    path: (projectId: string) => `projects/${projectId}/tickets`,
    schema: Ticket,
    upgraders: { 1: ticketV1toV2, 2: ticketV2toV3 },
  },
  ticketEvents: {
    path: (projectId: string, ticketId: string) =>
      `projects/${projectId}/tickets/${ticketId}/events`,
    schema: TicketEvent,
    // Events never changed shape before v3, so a v1 event upgrades straight through.
    upgraders: { 1: (data: DocumentData) => data, 2: ticketEventV2toV3 },
  },
  questions: { path: () => "questions", schema: Question },
  runs: { path: () => "runs", schema: Run },
  providers: { path: () => "providers", schema: Provider },
  models: { path: () => "models", schema: Model },
  tiers: { path: () => "tiers", schema: Tier },
  policies: { path: () => "policies", schema: Policy },
  quotaReadings: { path: () => "quotaReadings", schema: QuotaReading },
  quotaClears: { path: () => "quotaClears", schema: QuotaClear },
  configChanges: { path: () => "configChanges", schema: ConfigChange },
  proposalLookupCursors: { path: () => "proposalLookupCursors", schema: ProposalLookupCursor },
  releases: { path: () => "releases", schema: Release },
  releaseNotes: {
    path: (projectId: string) => `projects/${projectId}/releaseNotes`,
    schema: ReleaseNote,
  },
  milestones: {
    path: (projectId: string) => `projects/${projectId}/milestones`,
    schema: Milestone,
  },
  /** AI-323: one model-written summary per project per day (ADR-0137). */
  digestSummaries: {
    path: (projectId: string) => `projects/${projectId}/digestSummaries`,
    schema: DigestSummary,
  },
  /** Summary writes started per UTC day across projects (ADR-0137), server-only: `{ count }`. */
  digestSummaryDays: { path: () => "digestSummaryDays" },
  oauthGrants: { path: () => "oauthGrants", schema: OAuthGrant },
  codeHostEvents: { path: () => "codeHostEvents", schema: CodeHostEvent },
  /** Local runners and their per-run tokens (ADR-0089); validated by `FirestoreRunnerStore`. */
  runners: { path: () => "runners" },
  runTokens: { path: () => "runTokens" },
  /** Overnight launches (ADR-0049), server-only; validated by `FirestoreNightLaunchStore`. */
  nightLaunches: { path: () => "nightLaunches" },
  /** Per-project change counters (AI-222), server-only; read by `FirestoreProjectVersions`. */
  projectVersions: { path: () => "projectVersions" },
  /** Web Push (M7.7), server-only; subscriptions keyed by SHA-256 of the endpoint, the rest by uid. */
  pushSubscriptions: { path: () => "pushSubscriptions", schema: PushSubscription },
  pushSettings: { path: () => "pushSettings", schema: PushSettings },
  pushSendStates: { path: () => "pushSendStates", schema: PushSendState },
  /** Singleton settings documents, e.g. `config/codeHost` (ADR-0043). */
  config: { path: () => "config" },
} as const;

/**
 * Zod-validated converter: rejects malformed documents on read and write. On read, older
 * documents go through `upgraders` (by the version they upgrade from) before validation.
 */
export function zodConverter<S extends z.ZodType<DocumentData>>(
  schema: S,
  upgraders: Partial<Record<number, Upgrader>> = {},
): FirestoreDataConverter<z.infer<S>> {
  return {
    toFirestore(value) {
      return { ...schema.parse(value), _v: SCHEMA_VERSION };
    },
    fromFirestore(snapshot: QueryDocumentSnapshot) {
      const { _v, ...data } = snapshot.data();
      return schema.parse(upgrade(data, _v, upgraders));
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
  upgraders: Partial<Record<number, Upgrader>> = {},
): CollectionReference<z.infer<S>> {
  return db.collection(path).withConverter(zodConverter(schema, upgraders));
}

export * from "./exports.gen";
