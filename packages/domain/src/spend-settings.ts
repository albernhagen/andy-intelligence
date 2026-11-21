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
 * Global caps are the code defaults until AI-276: M10: Global spend caps store and editing.
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

/** Where the global caps come from: the code defaults until AI-276 stores them. */
export type GlobalCapsSource = "default";

export interface SpendView {
  global: { caps: SpendCaps; source: GlobalCapsSource };
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
  global: SpendCaps = DEFAULT_SPEND_CAPS,
): SpendView {
  const own = ProjectSpendCaps.parse(project ?? {});
  return {
    global: { caps: SpendCaps.parse(global), source: "default" },
    project: own,
    effective: effectiveCaps(global, own),
    spent,
  };
}
