import {
  ProviderKey,
  RunStep,
  TierKey,
  type Route,
  type RoutingConfig,
  type StepTier,
} from "@andy/contracts";
import { PROVIDER_LABELS, STEP_LABELS, TIER_LABELS, modelName } from "@/lib/settings-labels";

/** The parts of a routing config the Models editor changes. */
export type RoutingFields = Pick<RoutingConfig, "providers" | "tiers" | "steps">;

/** A part of the editor a change sits in, so its "Saved" cue shows there (AI-376). */
export type RoutingPart = `tier:${TierKey}` | `step:${RunStep}` | `provider:${ProviderKey}`;

export interface RoutingChange {
  part: RoutingPart;
  /** What changed, in words: "Fast: added route 2". */
  summary: string;
}

const sameRoute = (a: Route, b: Route) =>
  a.harness === b.harness && a.provider === b.provider && a.model === b.model;

const pct = (n: number) => (Number.isNaN(n) ? "?" : `${n}`);

const stepTierName = (t: StepTier) => (t === "by_size" ? "By size" : TIER_LABELS[t].name);

/** One tier's change in words: a route added or removed at the end, reordered, or edited. */
function tierSummary(name: string, before: Route[], after: Route[]): string {
  if (after.length === before.length + 1 && before.every((r, i) => sameRoute(r, after[i]!))) {
    return `${name}: added route ${after.length}`;
  }
  if (after.length < before.length) {
    const removed = before.length - after.length;
    return `${name}: removed ${removed === 1 ? "a route" : `${removed} routes`}`;
  }
  const sameSet =
    after.length === before.length &&
    after.every((r) => before.some((b) => sameRoute(b, r))) &&
    before.every((b) => after.some((r) => sameRoute(b, r)));
  if (sameSet) return `${name}: routes reordered`;
  const first = after.findIndex((r, i) => !before[i] || !sameRoute(r, before[i]!));
  return `${name}: route ${first + 1} now ${modelName(after[first]!.model)}`;
}

/** A provider's change in words: its switch, else which levels changed. */
function providerSummary(
  key: ProviderKey,
  before: RoutingFields["providers"][ProviderKey],
  after: RoutingFields["providers"][ProviderKey],
) {
  const name = PROVIDER_LABELS[key].name;
  if (before.enabled !== after.enabled) return `${name}: ${after.enabled ? "on" : "off"}`;
  const levels = [
    before.warnPct !== after.warnPct && `warn ${pct(after.warnPct)}%`,
    before.pausePct !== after.pausePct && `pause ${pct(after.pausePct)}%`,
    before.reservePct !== after.reservePct && `reserve ${pct(after.reservePct)}%`,
    before.dailyTaskLimit !== after.dailyTaskLimit &&
      `tasks a day ${after.dailyTaskLimit ?? "not set"}`,
  ].filter(Boolean);
  return `${name}: ${levels.join(", ")}`;
}

/**
 * Every unsaved change between the last saved routing and the draft, in the order the page shows
 * them (tiers, steps, providers). The save bar counts and names them.
 */
export function routingChanges(saved: RoutingFields, draft: RoutingFields): RoutingChange[] {
  const changes: RoutingChange[] = [];
  for (const tier of TierKey.options) {
    const before = saved.tiers[tier];
    const after = draft.tiers[tier];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes.push({
      part: `tier:${tier}`,
      summary: tierSummary(TIER_LABELS[tier].name, before, after),
    });
  }
  for (const step of RunStep.options) {
    if (saved.steps[step] === draft.steps[step]) continue;
    changes.push({
      part: `step:${step}`,
      summary: `${STEP_LABELS[step].name}: ${stepTierName(saved.steps[step])} → ${stepTierName(draft.steps[step])}`,
    });
  }
  for (const key of ProviderKey.options) {
    if (JSON.stringify(saved.providers[key]) === JSON.stringify(draft.providers[key])) continue;
    changes.push({
      part: `provider:${key}`,
      summary: providerSummary(key, saved.providers[key], draft.providers[key]),
    });
  }
  return changes;
}
