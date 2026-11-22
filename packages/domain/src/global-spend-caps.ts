import {
  configChangeId,
  CONFIG_CHANGE_LIST_MAX,
  ConfigChange,
  DEFAULT_SPEND_CAPS,
  GLOBAL_ENTITY_ID,
  SpendCaps,
  WorkTrackerError,
  notFound,
  type ConfigChangeLog,
  type EventActor,
  type SpendCapsStore,
} from "@andy/contracts";
import { CONFIG_CHANGE_NOT_RECORDED, changeActor, revertReason } from "./config-changes";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";
import { formatMicroUsd } from "./spend-settings";

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "global-spend-caps", ...fields }));
}

/** The ConfigChange entity of a global spend caps change (AI-276); its `entityId` is global. */
export const SPEND_CAPS_ENTITY = "spend-caps";

const FIELDS = ["dailyMicroUsd", "monthlyMicroUsd", "perTaskMicroUsd"] as const;

/** The global caps in force: stored, or the code defaults while none are stored. */
export interface GlobalCaps {
  caps: SpendCaps;
  source: "default" | "stored";
  /** When they were last saved; null for the defaults. Pass it back to save (stale: conflict). */
  updatedAt: string | null;
}

/**
 * The global spend caps (AI-276; ADR-0129): the ceiling every project's own caps narrow. Read
 * from the store, the code defaults while none are stored. A read that fails throws, and every
 * caller fails closed: the spend gate starts no paid task, a project cap can't be checked so it
 * isn't saved. Saving is the owner's (`change_spend_caps`), checked against the version read,
 * and each save appends a global ConfigChange (entity `spend-caps`), revertable from its log.
 */
export class GlobalSpendCaps {
  constructor(
    /** Null where none is configured (tests, local dev): the defaults, read-only. */
    private readonly store: SpendCapsStore | null,
    private readonly changes: ConfigChangeLog | null,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => configChangeId(),
  ) {}

  /** Throws when the store can't be read: callers must not treat that as the defaults. */
  async read(): Promise<GlobalCaps> {
    if (!this.store) return { caps: DEFAULT_SPEND_CAPS, source: "default", updatedAt: null };
    let stored;
    try {
      stored = await this.store.getGlobal();
    } catch (err) {
      log("ERROR", "global spend caps unreadable", { error: String(err) });
      throw err;
    }
    if (!stored) return { caps: DEFAULT_SPEND_CAPS, source: "default", updatedAt: null };
    const { updatedAt, ...caps } = stored;
    return { caps: SpendCaps.parse(caps), source: "stored", updatedAt };
  }

  /** The caps alone, for the spend gate and the project cap check. Throws like `read`. */
  async caps(): Promise<SpendCaps> {
    return (await this.read()).caps;
  }

  /**
   * Saves the global caps as the owner. `ifUpdatedAt` is the `updatedAt` the caller read (null
   * for the defaults); another save since is a `conflict` (409) and nothing changes. Lowering
   * global below a project's own cap is allowed: the lower one applies (`effectiveCaps`).
   */
  async put(
    caps: SpendCaps,
    ifUpdatedAt: string | null,
    actor: EventActor,
    reason?: string,
  ): Promise<GlobalCaps> {
    requireCan(actor, "change_spend_caps", null);
    const store = this.requireStore();
    const next = SpendCaps.parse(caps);
    const before = await this.read();
    if (before.updatedAt !== ifUpdatedAt) {
      throw new WorkTrackerError("conflict", "the global spend caps changed since they were read");
    }
    const saved = await store.putGlobal(next, ifUpdatedAt);
    const { updatedAt, ...after } = saved;
    await this.record(before.caps, after, actor, reason);
    return { caps: after, source: "stored", updatedAt };
  }

  /** The global caps' changes, newest first, at most `limit` (capped, ADR-0028). Owner only. */
  async changeLog(actor: EventActor, limit = CONFIG_CHANGE_LIST_MAX): Promise<ConfigChange[]> {
    requireCan(actor, "change_spend_caps", null);
    return this.requireLog().listGlobal(SPEND_CAPS_ENTITY, limit);
  }

  /**
   * Reverts one applied change: each cap it changed goes back to its before value through `put`,
   * so it is stored against the current version and logged as a new change; then the original is
   * marked `reverted`. Refused when a later change touched the same caps, or a cap no longer
   * holds the change's value (a save whose log append failed).
   */
  async revert(
    changeId: string,
    actor: EventActor,
  ): Promise<{ global: GlobalCaps; reverted: ConfigChange }> {
    requireCan(actor, "change_spend_caps", null);
    const changes = this.requireLog();
    const change = await changes.get(changeId);
    if (!change || change.entity !== SPEND_CAPS_ENTITY) {
      throw notFound("config change", changeId);
    }
    if (change.status !== "applied") {
      throw new DomainError("not_revertible", `config change ${change.id} is ${change.status}`, [
        "only an applied change can be reverted",
      ]);
    }
    const current = await this.read();
    const refusal = revertRefusal(
      change,
      current.caps,
      await changes.listGlobal(SPEND_CAPS_ENTITY),
    );
    if (refusal) throw refusal;
    const restored: SpendCaps = { ...current.caps };
    for (const [field, value] of Object.entries(change.diff)) {
      restored[field as (typeof FIELDS)[number]] = (value as { from: number }).from;
    }
    const global = await this.put(restored, current.updatedAt, actor, revertReason(change.id));
    let reverted: ConfigChange;
    try {
      reverted = await changes.markReverted(change.id, actor, this.now().toISOString());
    } catch (err) {
      if (err instanceof WorkTrackerError && err.code === "conflict") {
        throw new DomainError("not_revertible", `config change ${change.id} is already reverted`);
      }
      throw err;
    }
    log("INFO", "global spend caps change reverted", { configChangeId: change.id, by: actor });
    return { global, reverted };
  }

  /**
   * Appends the save's ConfigChange. The caps are already stored, so nothing here fails the
   * request: a failure logs an ERROR with the diff (the same message the projects alert matches).
   */
  private async record(
    before: SpendCaps,
    after: SpendCaps,
    actor: EventActor,
    reason: string | undefined,
  ): Promise<void> {
    if (!this.changes) return;
    const diff = Object.fromEntries(
      FIELDS.filter((f) => before[f] !== after[f]).map((f) => [
        f,
        { from: before[f], to: after[f] },
      ]),
    );
    if (Object.keys(diff).length === 0) return;
    const at = this.now().toISOString();
    const id = this.newId();
    try {
      await this.changes.append(
        ConfigChange.parse({
          id,
          entity: SPEND_CAPS_ENTITY,
          entityId: GLOBAL_ENTITY_ID,
          projectId: null,
          diff,
          actor: changeActor(actor),
          reason: reason?.trim() ?? "",
          status: "applied",
          createdAt: at,
          appliedAt: at,
        }),
      );
      log("INFO", "global spend caps changed", {
        configChangeId: id,
        changes: Object.entries(diff).map(
          ([f, v]) => `${f}: ${formatMicroUsd(v.from)} → ${formatMicroUsd(v.to)}`,
        ),
        by: actor,
      });
    } catch (err) {
      log("ERROR", CONFIG_CHANGE_NOT_RECORDED, {
        configChangeId: id,
        diff,
        by: actor,
        error: String(err),
      });
    }
  }

  private requireStore(): SpendCapsStore {
    if (!this.store) {
      throw new DomainError("invalid_field", "the global spend caps store isn't configured");
    }
    return this.store;
  }

  private requireLog(): ConfigChangeLog {
    if (!this.changes) {
      throw new DomainError("not_revertible", "the config change log isn't configured");
    }
    return this.changes;
  }
}

/** Why `change` can't be reverted because the caps moved on since, or null when it can. */
function revertRefusal(
  change: ConfigChange,
  current: SpendCaps,
  logged: ConfigChange[],
): DomainError | null {
  const fields = Object.keys(change.diff);
  const newer = logged
    // A change in the same millisecond counts as newer: the log can't order them, so refuse.
    .filter((c) => c.id !== change.id && c.createdAt >= change.createdAt)
    .filter((c) => Object.keys(c.diff).some((f) => fields.includes(f)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (newer[0]) {
    return new DomainError(
      "not_revertible",
      `${Object.keys(newer[0].diff)
        .filter((f) => fields.includes(f))
        .join(", ")} changed since, by config change ${newer[0].id} at ${newer[0].createdAt}`,
      ["revert the newer change first, or set the caps directly"],
    );
  }
  const stale = fields.filter(
    (f) => current[f as (typeof FIELDS)[number]] !== (change.diff[f] as { to: number }).to,
  );
  if (stale.length > 0) {
    return new DomainError(
      "not_revertible",
      `${stale.join(", ")} changed since, by a save not in the change log`,
      ["set the caps directly"],
    );
  }
  return null;
}
