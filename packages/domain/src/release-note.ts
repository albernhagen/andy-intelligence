/**
 * The release-note block every PR description carries (AI-159, ADR-0121): three labelled lines,
 * parsed here and nowhere else. The PR check (`scripts/release-note-check.mjs`) imports this file
 * directly with Node's type stripping, so it must stay free of runtime imports.
 *
 *   What changed: <one plain sentence, at most 25 words: what Andy can now do or see>
 *   How it works: <at most 45 words: the mechanism>
 *   Needs you: <optional, at most 25 words: a step only Andy can take>
 *
 * A field's text runs from its label to the next blank line, label or heading. Labels may be
 * bold (`**What changed:**`) or list items. Lines inside code fences are skipped, so examples in
 * a description never count. PR text is untrusted: this only extracts and measures it.
 */

/** Word caps per field. */
export const RELEASE_NOTE_CAPS = { whatChanged: 25, howItWorks: 45, needsYou: 25 } as const;

/** A stored field never exceeds this many characters, whatever its word count (ADR-0028). */
export const RELEASE_NOTE_MAX_CHARS = 400;

export interface ReleaseNoteFields {
  whatChanged: string;
  howItWorks: string;
  needsYou: string | null;
}

export interface ReleaseNoteParse {
  /** The fields, when both required ones are present (even if over a cap); else null. */
  note: ReleaseNoteFields | null;
  /** One plain sentence per problem; empty when the block is valid. */
  problems: string[];
}

type Field = keyof ReleaseNoteFields;

const LABELS: Record<Field, string> = {
  whatChanged: "What changed",
  howItWorks: "How it works",
  needsYou: "Needs you",
};

/** `What changed:`, `**What changed:**`, `- **What changed**:` … at the start of a line. */
const LABEL_LINE =
  /^\s*(?:[-*]\s+)?(?:\*\*|__)?\s*(what changed|how it works|needs you)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?(.*)$/i;
const FIELD_BY_LABEL: Record<string, Field> = {
  "what changed": "whatChanged",
  "how it works": "howItWorks",
  "needs you": "needsYou",
};

export const releaseNoteWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Finds each field's first occurrence outside code fences. */
function extract(body: string): Partial<Record<Field, string>> {
  const found: Partial<Record<Field, string>> = {};
  let current: Field | null = null;
  let parts: string[] = [];
  let fenced = false;
  const close = () => {
    if (current && found[current] === undefined) found[current] = clean(parts.join(" "));
    current = null;
    parts = [];
  };
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      close();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const label = LABEL_LINE.exec(line);
    if (label) {
      close();
      current = FIELD_BY_LABEL[label[1]!.toLowerCase()]!;
      parts = [label[2] ?? ""];
      continue;
    }
    if (!current) continue;
    if (line.trim() === "" || /^\s*(#|<!--)/.test(line)) close();
    else parts.push(line);
  }
  close();
  return found;
}

/** Parses and checks the block: missing required fields, empty fields and word caps. */
export function parseReleaseNote(body: string): ReleaseNoteParse {
  const found = extract(body ?? "");
  const problems: string[] = [];
  for (const field of ["whatChanged", "howItWorks"] as const) {
    if (!found[field]) problems.push(`"${LABELS[field]}:" is missing or empty.`);
  }
  for (const field of Object.keys(RELEASE_NOTE_CAPS) as Field[]) {
    const text = found[field];
    if (!text) continue;
    const words = releaseNoteWords(text);
    const cap = RELEASE_NOTE_CAPS[field];
    if (words > cap) {
      problems.push(
        `"${LABELS[field]}:" is ${words} words; the cap is ${cap} (${words - cap} over).`,
      );
    }
  }
  if (found.needsYou === "") problems.push(`"${LABELS.needsYou}:" is empty: remove it or fill it.`);
  const note =
    found.whatChanged && found.howItWorks
      ? {
          whatChanged: found.whatChanged.slice(0, RELEASE_NOTE_MAX_CHARS),
          howItWorks: found.howItWorks.slice(0, RELEASE_NOTE_MAX_CHARS),
          needsYou: found.needsYou ? found.needsYou.slice(0, RELEASE_NOTE_MAX_CHARS) : null,
        }
      : null;
  return { note, problems };
}

/**
 * The first sentence of a description's first prose paragraph, for notes written before the
 * block existed (the backfill). Skips headings, links-only lines, comments, lists' markers and
 * code; cuts to the field's word cap with "…". Empty when there is no prose.
 */
export function firstSentence(body: string, maxWords: number = RELEASE_NOTE_CAPS.whatChanged) {
  let fenced = false;
  for (const raw of (body ?? "").split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    const line = raw.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim();
    if (fenced || !line || /^(#|<!--|>|\|)/.test(line)) continue;
    if (/^(ticket:\s*)?<?https?:\/\/\S+>?$/i.test(line)) continue;
    const text = clean(line.replace(/\*\*|__|`/g, ""));
    const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
    const words = sentence.split(" ");
    const capped = words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : sentence;
    return capped.slice(0, RELEASE_NOTE_MAX_CHARS);
  }
  return "";
}
