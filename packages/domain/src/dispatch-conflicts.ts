import { RUN_TOUCHES_MAX, type InFlightRun, type Run } from "@andy/contracts";
import { isInFlight } from "./dispatch-caps";

/**
 * Conflict-aware dispatch (ADR-0080, ADR-0047, ADR-0058). Pure: `BuildDispatcher` and the status
 * line gather the runs; `RunService` reserves ADR numbers with these rules.
 *
 * `touches` is untrusted agent text (refine drafts it), so only a safe subset is matched, with
 * no regular expressions: literal segments, `*` within a segment and `**` as a whole segment,
 * within the limits below. Anything else makes the whole list unknown, which overlaps
 * everything: it only delays a run.
 */
export const TOUCH_LIMITS = { chars: 300, segments: 32, stars: 8 } as const;

const SAFE_PATH = /^[A-Za-z0-9._\-/@+~*]+$/;

/** "./a/B/" → "a/b/**": a trailing slash names a directory; case is ignored (errs to overlap). */
function normalize(path: string): string {
  const p = path
    .trim()
    .replace(/^\.?\//, "")
    .toLowerCase();
  return p.endsWith("/") ? `${p}**` : p;
}

function isSafe(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= TOUCH_LIMITS.chars &&
    SAFE_PATH.test(path) &&
    path.split("/").length <= TOUCH_LIMITS.segments &&
    path.split("*").length - 1 <= TOUCH_LIMITS.stars
  );
}

/** The list normalized, or null when it is unknown: empty, too long, or with an unsafe entry. */
function safeList(list: readonly string[]): string[] | null {
  if (list.length === 0 || list.length > RUN_TOUCHES_MAX) return null;
  const out = list.map(normalize);
  return out.every(isSafe) ? out : null;
}

/** The part before the first `*`: every path the glob matches starts with it. */
function staticPrefix(glob: string): string {
  const i = glob.indexOf("*");
  return i < 0 ? glob : glob.slice(0, i);
}

/** One segment against a pattern where `*` is any run of characters: two pointers, no backtracking blow-up. */
function segmentMatches(pattern: string, text: string): boolean {
  let [p, t, star, mark] = [0, 0, -1, 0];
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      mark = t;
    } else if (star >= 0) {
      p = star + 1;
      t = ++mark;
    } else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}

/** Whether the glob matches the path, segment by segment (`**`: any number of segments). */
export function globMatches(glob: string, path: string): boolean {
  const [g, s] = [glob.split("/"), path.split("/")];
  // memo[i][j]: does g[i..] match s[j..]? Bounded by TOUCH_LIMITS.segments squared.
  const memo = new Map<number, boolean>();
  const match = (i: number, j: number): boolean => {
    const key = i * (s.length + 1) + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    if (i === g.length) result = j === s.length;
    else if (g[i] === "**") result = match(i + 1, j) || (j < s.length && match(i, j + 1));
    else result = j < s.length && segmentMatches(g[i]!, s[j]!) && match(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return match(0, 0);
}

/** A literal names a file or a directory, so it covers itself and everything under it. */
function literalsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function pairOverlaps(a: string, b: string): boolean {
  const [globA, globB] = [a.includes("*"), b.includes("*")];
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
    globMatches(glob, literal) ||
    prefix.startsWith(`${literal}/`) ||
    (glob.includes("**") && literal.startsWith(prefix))
  );
}

/**
 * Whether two `touches` lists can edit the same file: any glob of one matches or contains any
 * glob of the other. An unknown list (empty, or outside the safe subset) overlaps everything.
 */
export function overlaps(a: readonly string[], b: readonly string[]): boolean {
  const [sa, sb] = [safeList(a), safeList(b)];
  if (!sa || !sb) return true;
  return sa.some((x) => sb.some((y) => pairOverlaps(x, y)));
}

/**
 * Runs that can conflict: build runs in flight (`isInFlight`, the one definition the caps, the
 * in-flight view and the status line share). Refine and plan runs are read-only.
 */
export function editingRuns(runs: readonly Run[], now: Date): Run[] {
  return runs.filter((r) => r.step === "build" && isInFlight(r, now));
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
      .sort(
        (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id),
      )
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

/** "ADR-0080" */
export function adrLabel(n: number): string {
  return `ADR-${String(n).padStart(4, "0")}`;
}
