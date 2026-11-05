/**
 * Order in a lane is the priority (ADR-0058). Ranks sort as plain strings. A new ticket's rank is
 * its zero-padded number (`rankFor`, 10 digits). A reorder (AI-28: Board v2) places a ticket
 * between its new neighbours by keeping a 10-digit whole part and adding a decimal fraction:
 * "0000000028" < "0000000028.5" < "0000000029" ('.' sorts before every digit). The fraction
 * never ends in 0, so there is always room for another rank between two others.
 */

const WHOLE_DIGITS = 10;
const RANK = /^(\d{10})(?:\.(\d*[1-9]))?$/;

interface Parts {
  whole: number;
  fraction: string;
}

function parse(rank: string): Parts {
  const m = RANK.exec(rank);
  if (!m) throw new Error(`not a rank: ${rank}`);
  return { whole: Number(m[1]), fraction: m[2] ?? "" };
}

function format({ whole, fraction }: Parts): string {
  const w = String(whole).padStart(WHOLE_DIGITS, "0");
  return fraction ? `${w}.${fraction}` : w;
}

/**
 * Decimal digits strictly between fractions `a` and `b` (`b` null means 1.0); neither ends in 0.
 * The midpoint method of the fractional-indexing technique, in base 10.
 */
function fractionBetween(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + fractionBetween(a.slice(n), b.slice(n));
  }
  const lo = a ? Number(a[0]) : 0;
  const hi = b !== null ? Number(b[0]) : 10;
  if (hi - lo > 1) return String(Math.round((lo + hi) / 2));
  if (b !== null && b.length > 1) return b[0]!;
  return String(lo) + fractionBetween(a.slice(1), null);
}

/**
 * A rank that sorts strictly between `before` and `after` (the ticket's new neighbours above and
 * below; null at either end of the lane). If the neighbours are equal or out of order (two
 * tickets moved independently), it returns a rank just after `before`.
 */
export function rankBetween(before: string | null, after: string | null): string {
  if (before === null && after === null) return format({ whole: 1, fraction: "" });
  if (before === null) {
    const b = parse(after!);
    if (b.fraction) return format({ whole: b.whole, fraction: fractionBetween("", b.fraction) });
    if (b.whole > 0) return format({ whole: b.whole - 1, fraction: fractionBetween("", null) });
    throw new Error("no rank sorts before 0000000000");
  }
  const a = parse(before);
  const b = after === null || after <= before ? null : parse(after);
  if (b !== null && b.whole === a.whole) {
    return format({ whole: a.whole, fraction: fractionBetween(a.fraction, b.fraction) });
  }
  return format({ whole: a.whole, fraction: fractionBetween(a.fraction, null) });
}
