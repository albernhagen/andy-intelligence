#!/usr/bin/env node
// Features index (AI-141): each shipped feature is one file in `docs/features/`, so two PRs
// never edit the same lines. No index is committed (a committed one would conflict again);
// this prints it on demand as one markdown table.
//
// File format (README.md in the folder is skipped):
//   # <Feature name>
//
//   <What it does>
//
//   **How to use:** <how to use it>
//
// Usage: node scripts/features.mjs [repo-dir]. Prints the table; exit 1 when a file is
// malformed or two files share a name.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FEATURES_DIR = "docs/features";
const HOW = "**How to use:**";

/** @returns {{ name: string, what: string, how: string }} */
export function parseFeature(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const title = lines[0]?.match(/^# (.+)$/);
  if (!title) throw new Error('first line must be "# <Feature name>"');
  const howAt = lines.findIndex((l) => l.startsWith(HOW));
  if (howAt === -1) throw new Error(`needs a "${HOW}" line`);
  const what = lines.slice(1, howAt).join("\n").trim();
  const how = [lines[howAt].slice(HOW.length), ...lines.slice(howAt + 1)].join("\n").trim();
  if (!what) throw new Error("needs a what-it-does paragraph after the title");
  if (!how) throw new Error(`"${HOW}" is empty`);
  return { name: title[1].trim(), what, how };
}

// Backslashes first, so an escaped pipe in the source can't end a cell.
const cell = (s) =>
  s
    .replace(/\s*\n\s*/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|");

/** @param {{ name: string, what: string, how: string, file: string }[]} features */
export function renderIndex(features) {
  const rows = features.map(
    (f) => `| [${cell(f.name)}](${FEATURES_DIR}/${f.file}) | ${cell(f.what)} | ${cell(f.how)} |`,
  );
  return ["| Feature | What it does | How to use |", "| --- | --- | --- |", ...rows].join("\n");
}

/** Reads every feature file, sorted by file name. Errors name the file. */
export function loadFeatures(dir) {
  const folder = join(dir, FEATURES_DIR);
  const features = [];
  const errors = [];
  const files = readdirSync(folder)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();
  for (const file of files) {
    try {
      features.push({ ...parseFeature(readFileSync(join(folder, file), "utf8")), file });
    } catch (err) {
      errors.push(`${FEATURES_DIR}/${file}: ${err.message}`);
    }
  }
  const seen = new Map();
  for (const f of features) {
    if (seen.has(f.name)) errors.push(`${f.file} and ${seen.get(f.name)} share "${f.name}"`);
    seen.set(f.name, f.file);
  }
  return { features, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { features, errors } = loadFeatures(process.argv[2] ?? ".");
  if (errors.length > 0) {
    process.stderr.write(`features: ${errors.join("\nfeatures: ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${renderIndex(features)}\n`);
}
