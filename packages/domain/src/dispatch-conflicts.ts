import { RUN_TOUCHES_MAX, type InFlightRun, type Run } from "@andy/contracts";
import { globToRegExp } from "./gate";

/**
 * Conflict-aware dispatch (ADR-0080, ADR-0047, ADR-0058). Pure: `BuildDispatcher` and the status
 * line gather the runs; `RunService` reserves ADR numbers with these rules.
 */

const GLOB_CHARS = /[*?[{]/;

/** "./a/b/" → "a/b/**": a trailing slash names a directory. */
function normalize(path: string): string {
  const p = path.trim().replace(/^\.?\//, "");
  return p.endsWith("/") ? `${p}**` : p;
}

/** The part before the first glob character: every path the glob matches starts with it. */
function staticPrefix(glob: string): string {
  const i = glob.search(GLOB_CHARS);
  return i < 0 ? glob : glob.slice(0, i);
}

/** A literal names a file or a directory, so it covers itself and everything under it. */
function literalsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function pairOverlaps(rawA: string, rawB: string): boolean {
  const [a, b] = [normalize(rawA), normalize(rawB)];
  const [globA, globB] = [GLOB_CHARS.test(a), GLOB_CHARS.test(b)];
  if (!globA && !globB) return literalsOverlap(a, b);
  if (globA && globB) {
    // Two globs: overlap unless their fixed prefixes diverge. Errs towards overlap, which
    // only delays a run; missing an overlap would cause a conflict.
    const [pa, pb] = [staticPrefix(a), staticPrefix(b)];
    return pa.startsWith(pb) || pb.startsWith(pa);
  }
  const [glob, literal] = globA ? [a, b] : [b, a];
  const prefix = staticPrefix(glob);
  // The glob matches the file; the literal is a directory holding the glob's paths; or the
  // literal may be a directory a `**` glob descends into.
  return (
    globToRegExp(glob).test(literal) ||
    prefix.startsWith(`${literal}/`) ||
    (glob.includes("**") && literal.startsWith(prefix))
  );
}

/**
 * Whether two `touches` lists can edit the same file: any glob of one matches or contains any
 * glob of the other. An empty list is unknown and overlaps everything.
 */
export function overlaps(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((x) => b.some((y) => pairOverlaps(x, y)));
}

/** Runs that can conflict: build runs edit and push; refine and plan runs are read-only. */
export function editingRuns(runs: readonly Run[], now: Date): Run[] {
  const nowMs = now.getTime();
  return runs.filter(
    (r) =>
      r.step === "build" &&
      (r.status === "queued" || r.status === "running") &&
      // Past its deadline the run counts nowhere (as in the dispatch caps, ADR-0079).
      (!r.deadline || Date.parse(r.deadline) > nowMs),
  );
}

/**
 * The first in-flight run (oldest first) whose touches overlap the ticket's, or null. A ticket
 * with no touches runs only when nothing is in flight. The ticket's own run never blocks it.
 */
export function blockingRun(
  ticket: { id: string; touches: readonly string[] },
  inFlight: readonly Run[],
): Run | null {
  return (
    [...inFlight]
      .filter((r) => r.ticketId !== ticket.id)
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
      .find((r) => overlaps(ticket.touches, r.touches)) ?? null
  );
}

/**
 * The key of the in-flight build (oldest first) a Ready ticket waits on, for its status line:
 * the same rule as `blockingRun`, over the in-flight view the UI and MCP already read.
 */
export function overlappingKey(
  ticket: { key: string; touches: readonly string[] },
  inFlight: readonly InFlightRun[],
): string | null {
  const hit = inFlight.find(
    (r) => r.step === "build" && r.ticketKey !== ticket.key && overlaps(ticket.touches, r.touches),
  );
  return hit ? (hit.ticketKey ?? "a run") : null;
}

/** What a build run records at start: the ticket's touches plus the approved plan's files. */
export function runTouches(
  ticketTouches: readonly string[],
  planFiles: readonly string[] = [],
): string[] {
  // An unknown ticket stays unknown unless the plan names files.
  return [...new Set([...ticketTouches, ...planFiles])].slice(0, RUN_TOUCHES_MAX);
}

/** The highest ADR number in an index (`docs/architecture/adr/README.md` rows: `| [0079](…`). */
export function highestAdrInIndex(readme: string): number | null {
  const numbers = [...readme.matchAll(/^\|\s*\[(\d{4})\]\(/gm)].map((m) => Number(m[1]));
  return numbers.length ? Math.max(...numbers) : null;
}

/**
 * The next ADR number: one above the highest on the default branch and every number any run
 * in the project ever reserved (never reused, so an open PR's number stays its own).
 */
export function nextAdrNumber(indexHighest: number, reservedHighest: number | null): number {
  return Math.max(indexHighest, reservedHighest ?? 0) + 1;
}

/** "ADR-0080" */
export function adrLabel(n: number): string {
  return `ADR-${String(n).padStart(4, "0")}`;
}
