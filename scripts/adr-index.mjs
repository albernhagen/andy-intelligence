#!/usr/bin/env node
// ADR index (AI-142): each ADR's frontmatter carries its short `title` and `status`; this
// prints the index from them, one line per ADR, so no PR edits a shared index by hand.
//
// Frontmatter (between `---` lines at the top; one `key: value` per line, a value may be
// double-quoted): `title` and `status` required; `amends`, `supersedes` shown when present.
//
// Usage: node scripts/adr-index.mjs [repo-dir]. Prints the index; exit 1 when an ADR lacks
// a title or status, or two ADRs share a number.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ADR_DIR = "docs/architecture/adr";
export const ADR_FILE = /^(\d{4})-.+\.md$/;

/** The frontmatter as a flat key → value map; null when the file has none. */
export function parseFrontmatter(text) {
  const block = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n/);
  if (!block) return null;
  const fields = {};
  for (const line of block[1].split("\n")) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const value = line.slice(at + 1).trim();
    fields[line.slice(0, at).trim()] = value.startsWith('"') ? JSON.parse(value) : value;
  }
  return fields;
}

/** @returns {{ number: string, file: string, title: string, status: string, amends?: string, supersedes?: string }} */
export function parseAdr(file, text) {
  const number = file.match(ADR_FILE)?.[1];
  if (!number) throw new Error('file name must be "NNNN-<slug>.md"');
  const fields = parseFrontmatter(text);
  if (!fields) throw new Error("needs frontmatter between --- lines");
  if (!fields.title) throw new Error('frontmatter needs "title"');
  if (!fields.status) throw new Error('frontmatter needs "status"');
  const { title, status, amends, supersedes } = fields;
  return { number, file, title, status, amends, supersedes };
}

export function renderIndex(adrs) {
  return adrs
    .map((a) => {
      const extra = [a.supersedes && `supersedes ${a.supersedes}`, a.amends && `amends ${a.amends}`]
        .filter(Boolean)
        .map((s) => `; ${s}`)
        .join("");
      return `- [${a.number}](${ADR_DIR}/${a.file}) ${a.title} — ${a.status}${extra}`;
    })
    .join("\n");
}

/** Reads every `NNNN-*.md` in the ADR folder, sorted by file name. Errors name the file. */
export function loadAdrs(dir) {
  const folder = join(dir, ADR_DIR);
  const adrs = [];
  const errors = [];
  const files = readdirSync(folder)
    .filter((f) => ADR_FILE.test(f))
    .sort();
  for (const file of files) {
    try {
      adrs.push(parseAdr(file, readFileSync(join(folder, file), "utf8")));
    } catch (err) {
      errors.push(`${ADR_DIR}/${file}: ${err.message}`);
    }
  }
  const seen = new Map();
  for (const a of adrs) {
    if (seen.has(a.number)) errors.push(`${a.file} and ${seen.get(a.number)} share ${a.number}`);
    seen.set(a.number, a.file);
  }
  return { adrs, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { adrs, errors } = loadAdrs(process.argv[2] ?? ".");
  if (errors.length > 0) {
    process.stderr.write(`adr index: ${errors.join("\nadr index: ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${renderIndex(adrs)}\n`);
}
