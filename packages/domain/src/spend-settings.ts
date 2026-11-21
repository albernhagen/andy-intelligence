import {
  DEFAULT_SPEND_CAPS,
  ProjectSpendCaps,
  SpendCaps,
  type EffectiveSpendCaps,
  type SpendSoFar,
} from "@andy/contracts";
import { effectiveCaps } from "./spend-caps";

/**
 * Spend caps settings (AI-249: M10.8): what Andy sees and may set. A project's caps can only be
 * lower than the global ones (ADR-0129); a higher one is refused with the reason, never stored.
 * The global caps come from `GlobalSpendCaps` (AI-276): stored, or the code defaults.
 */

const FIELDS = [
  ["dailyMicroUsd", "daily"],
  ["monthlyMicroUsd", "monthly"],
  ["perTaskMicroUsd", "per-task"],
] as const;

/** `$5.00` from 5,000,000 micro-dollars; whole cents, rounded down, never floats in storage. */
export function formatMicroUsd(microUsd: number): string {
  const cents = Math.floor(microUsd / 10_000);
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Why `project`'s caps can't be stored under `global`: one reason per cap above its ceiling. */
export function projectCapsRefusal(global: SpendCaps, project: ProjectSpendCaps): string[] {
  const g = SpendCaps.parse(global);
  const p = ProjectSpendCaps.parse(project);
  return FIELDS.flatMap(([field, name]) => {
    const own = p[field];
    if (own === null || own === undefined || own <= g[field]) return [];
    return [
      `the project's ${name} cap ${formatMicroUsd(own)} is above the global ${name} cap ${formatMicroUsd(g[field])}; a project can only lower it`,
    ];
  });
}

export interface SpendView {
  global: { caps: SpendCaps; source: "default" | "stored"; updatedAt: string | null };
  /** The project's own caps as stored; a missing field takes the global value. */
  project: ProjectSpendCaps;
  /** What a paid call in this project is checked against. */
  effective: EffectiveSpendCaps;
  /** Spent in the current UTC day and month; null when the ledger can't be read (unknown). */
  spent: SpendSoFar | null;
}

export function spendView(
  project: ProjectSpendCaps | null | undefined,
  spent: SpendSoFar | null,
  global: { caps: SpendCaps; source: "default" | "stored"; updatedAt: string | null } = {
    caps: DEFAULT_SPEND_CAPS,
    source: "default",
    updatedAt: null,
  },
): SpendView {
  const own = ProjectSpendCaps.parse(project ?? {});
  const caps = SpendCaps.parse(global.caps);
  return {
    global: { caps, source: global.source, updatedAt: global.updatedAt },
    project: own,
    effective: effectiveCaps(caps, own),
    spent,
  };
}
