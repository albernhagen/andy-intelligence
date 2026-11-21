/**
 * The four DORA metrics (ADR-0040, M6: Dev → prod releases) over a time window, computed from
 * plain data: no store and no deployment record type, so any source of production deployments
 * can feed it. Pure: same input, same output.
 *
 * - Deploy frequency: production deployments per day and per week in the window.
 * - Lead time for changes: from each change's commit to the production deployment that shipped
 *   it, in hours (median and p90, nearest rank, as the dashboard's figures).
 * - Change failure rate: the share of the window's deployments that caused a failure in
 *   production (a rollback, a hotfix or an incident).
 * - Time to restore: from a failed deployment to its failure's resolution, in hours; failures not
 *   restored yet are counted, not measured.
 */

/** One production deployment, as plain data (ISO 8601 timestamps). */
export interface DoraDeployment {
  /** When it reached production. */
  deployedAt: string;
  /** When each change it shipped was committed (its lead time starts there). */
  changeCommittedAt: readonly string[];
  /** It caused a failure in production (rolled back, hotfixed or an incident). */
  failed: boolean;
  /** When that failure was resolved; null while it isn't, or when the deployment didn't fail. */
  restoredAt: string | null;
}

/** The window the metrics cover: `from` included, `to` excluded. */
export interface DoraWindow {
  from: string;
  to: string;
}

export interface Distribution {
  median: number | null;
  p90: number | null;
  count: number;
}

export interface DoraMetrics {
  /** Production deployments in the window. */
  deployments: number;
  /** Deployments per day and per week over the window's length; 0 when there were none. */
  deployFrequency: { perDay: number; perWeek: number };
  /** Commit to production, in hours, for every change the window's deployments shipped. */
  leadTimeHours: Distribution;
  /** Failed deployments over all deployments (0 to 1); null with no deployments. */
  changeFailureRate: number | null;
  failedDeployments: number;
  /**
   * Failed deployment to restore, in hours. `open`: failures not restored yet, or whose restore
   * time is unusable (also counted in `ignored`); `open + count` is always `failedDeployments`.
   */
  timeToRestoreHours: Distribution & { open: number };
  /**
   * Inputs left out: a deployment whose `deployedAt` doesn't parse, a change committed after the
   * deployment that shipped it, a restore before its failure. Counted so a bad feed shows.
   */
  ignored: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const time = (iso: string): number | null => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

/** Nearest-rank percentile; null for no samples. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

function distribution(samples: number[]): Distribution {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: round(percentile(sorted, 0.5)),
    p90: round(percentile(sorted, 0.9)),
    count: sorted.length,
  };
}

function round(n: number | null, decimals = 2): number | null {
  if (n === null) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function doraMetrics(
  deployments: readonly DoraDeployment[],
  window: DoraWindow,
): DoraMetrics {
  const from = time(window.from);
  const to = time(window.to);
  if (from === null || to === null || to <= from) {
    throw new RangeError("the DORA window needs valid timestamps with `from` before `to`");
  }
  let ignored = 0;
  const inWindow: (DoraDeployment & { at: number })[] = [];
  for (const d of deployments) {
    const at = time(d.deployedAt);
    if (at === null) {
      ignored += 1;
      continue;
    }
    if (at >= from && at < to) inWindow.push({ ...d, at });
  }

  const leadTimes: number[] = [];
  const restores: number[] = [];
  let failed = 0;
  let open = 0;
  for (const d of inWindow) {
    for (const committed of d.changeCommittedAt) {
      const c = time(committed);
      if (c === null || c > d.at) ignored += 1;
      else leadTimes.push((d.at - c) / HOUR);
    }
    if (!d.failed) continue;
    failed += 1;
    if (d.restoredAt === null) {
      open += 1;
      continue;
    }
    const restored = time(d.restoredAt);
    if (restored === null || restored < d.at) {
      // Not known to be restored: counted open (so open + count = failedDeployments) and ignored.
      ignored += 1;
      open += 1;
    } else restores.push((restored - d.at) / HOUR);
  }

  const days = (to - from) / DAY;
  const count = inWindow.length;
  return {
    deployments: count,
    deployFrequency: {
      perDay: round(count / days) ?? 0,
      perWeek: round((count / days) * 7) ?? 0,
    },
    leadTimeHours: distribution(leadTimes),
    changeFailureRate: count === 0 ? null : round(failed / count, 3),
    failedDeployments: failed,
    timeToRestoreHours: { ...distribution(restores), open },
    ignored,
  };
}
