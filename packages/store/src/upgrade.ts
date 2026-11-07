import type { DocumentData } from "@google-cloud/firestore";

/**
 * Read-time upgraders (ARCHITECTURE §10.4). Each takes a stored document at version N and
 * returns it at N + 1; the converter applies them in order on read, and the next write stores
 * the new shape. No batch migration.
 */
export type Upgrader = (data: DocumentData) => DocumentData;

const TYPE_RENAMES: Record<string, string> = { story: "feature", task: "chore" };

/**
 * Ticket v1 → v2 (ADR-0058: Ticket model): `story` → `feature`, `task` → `chore`,
 * `needsYou` → `needsAttention`, and the stored `tier` dropped (it is derived from size now;
 * `overrides.tier` still pins one). `outOfScope` and `touches` come from the schema defaults.
 */
export const ticketV1toV2: Upgrader = (data) => {
  const out: DocumentData = { ...data };
  delete out.needsYou;
  delete out.tier;
  if (typeof data.type === "string") out.type = TYPE_RENAMES[data.type] ?? data.type;
  out.needsAttention = data.needsAttention ?? data.needsYou ?? false;
  return out;
};

/** ADR-0069: the Monitoring stage is gone until M6: Dev → prod releases; it reads as Done. */
const stageV3 = (stage: unknown): unknown => (stage === "monitoring" ? "done" : stage);

/** Ticket v2 → v3 (ADR-0069): a ticket stored in Monitoring is Done. */
export const ticketV2toV3: Upgrader = (data) => ({ ...data, stage: stageV3(data.stage) });

/**
 * Ticket event v2 → v3 (ADR-0069): a `stage_changed` event's `from` and `to` read Monitoring as
 * Done, so history shows only stages that exist. Other kinds pass through.
 */
export const ticketEventV2toV3: Upgrader = (data) => {
  if (data.kind !== "stage_changed" || typeof data.data !== "object" || data.data === null) {
    return data;
  }
  const { from, to } = data.data as { from?: unknown; to?: unknown };
  return { ...data, data: { ...data.data, from: stageV3(from), to: stageV3(to) } };
};

/** Upgraders by the version they upgrade from. A document without `_v` is version 1. */
export function upgrade(
  data: DocumentData,
  version: unknown,
  upgraders: Partial<Record<number, Upgrader>>,
): DocumentData {
  let v = typeof version === "number" ? version : 1;
  let out = data;
  for (let next = upgraders[v]; next; next = upgraders[v]) {
    out = next(out);
    v += 1;
  }
  return out;
}
