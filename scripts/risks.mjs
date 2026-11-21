#!/usr/bin/env node
// Threat-model risk register (AI-144): each risk is one file in `docs/security/risks/`, named
// by its id, so two PRs never edit the same lines and two files can't hold the same id. No
// register is committed (a committed one would conflict again); this prints it on demand.
//
// File format (README.md in the folder is skipped):
//   ---
//   id: R1            (same as the file name; `R<n>` or `R-<TICKET>` / `R-<TICKET>-<n>`)
//   severity: medium  (critical | high | medium | low)
//   status: open      (open | mitigated | accepted | closed)
//   owner: Andy
//   ---
//
//   # R1
//
//   **Risk:** <what can go wrong>
//
//   **Mitigation / next step:** <what holds it, or what to do>
//
// Usage: node scripts/risks.mjs [repo-dir]. Prints the open register (every status but
// `closed`), then the closed risks; exit 1 when a file is malformed or two ids collide.
//        node scripts/risks.mjs --status <file | ->. Prints the frontmatter `status` exactly as
//        this parser reads it (empty if none); `-` reads stdin. The system review's CI uses it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RISKS_DIR = "docs/security/risks";
export const RISK_ID = /^R(\d+|-[A-Z][A-Z0-9]*-\d+(-\d+)?)$/;
export const SEVERITIES = ["critical", "high", "medium", "low"];
export const STATUSES = ["open", "mitigated", "accepted", "closed"];
const RISK = "**Risk:**";
const MITIGATION = "**Mitigation / next step:**";

/** The frontmatter as a flat key → value map; null when the file has none. */
export function parseFrontmatter(text) {
  const block = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!block) return null;
  const fields = {};
  for (const line of block[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return fields;
}

/** The `status` this parser reads from a risk file's text; "" when there is none. */
export function statusOf(text) {
  return parseFrontmatter(text.replace(/\r\n/g, "\n"))?.status ?? "";
}

/** @returns {{ id: string, severity: string, status: string, owner: string, risk: string, mitigation: string }} */
export function parseRisk(file, raw) {
  const text = raw.replace(/\r\n/g, "\n");
  const name = file.replace(/\.md$/, "");
  if (!RISK_ID.test(name)) throw new Error('file name must be "R<n>.md" or "R-<TICKET>.md"');
  const fields = parseFrontmatter(text);
  if (!fields) throw new Error("needs frontmatter between --- lines");
  const { id, severity, status, owner } = fields;
  if (id !== name) throw new Error(`frontmatter id "${id ?? ""}" must match the file name`);
  if (!SEVERITIES.includes(severity)) throw new Error(`severity must be ${SEVERITIES.join(" | ")}`);
  if (!STATUSES.includes(status)) throw new Error(`status must be ${STATUSES.join(" | ")}`);
  if (!owner) throw new Error('frontmatter needs "owner"');
  const riskAt = text.indexOf(RISK);
  const mitigationAt = text.indexOf(MITIGATION);
  if (riskAt === -1 || mitigationAt < riskAt) {
    throw new Error(`needs a "${RISK}" paragraph, then a "${MITIGATION}" one`);
  }
  const risk = text.slice(riskAt + RISK.length, mitigationAt).trim();
  const mitigation = text.slice(mitigationAt + MITIGATION.length).trim();
  if (!risk) throw new Error(`"${RISK}" is empty`);
  if (!mitigation) throw new Error(`"${MITIGATION}" is empty`);
  return { id, severity, status, owner, risk, mitigation };
}

// R2 before R10; R<n> before R-<TICKET>; tickets by key, then number.
const sortKey = (id) => {
  const m = id.match(/^R(?:(\d+)|-([A-Z][A-Z0-9]*)-(\d+)(?:-(\d+))?)$/);
  return m[1] ? ["", Number(m[1]), 0] : [m[2], Number(m[3]), Number(m[4] ?? 0)];
};
export function compareIds(a, b) {
  const [x, y] = [sortKey(a), sortKey(b)];
  return x[0].localeCompare(y[0]) || x[1] - y[1] || x[2] - y[2];
}

// Backslashes first, so an escaped pipe in the source can't end a cell.
const cell = (s) =>
  s
    .replace(/\s*\n\s*/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|");

function table(risks) {
  const rows = risks.map(
    (r) =>
      `| [${r.id}](${RISKS_DIR}/${r.id}.md) | ${r.severity} | ${r.status} | ${cell(r.owner)} | ${cell(r.risk)} | ${cell(r.mitigation)} |`,
  );
  return [
    "| ID | Severity | Status | Owner | Risk | Mitigation / next step |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** Open register (every status but closed), then closed risks; each sorted by id. */
export function renderRegister(risks) {
  const sorted = [...risks].sort((a, b) => compareIds(a.id, b.id));
  const open = sorted.filter((r) => r.status !== "closed");
  const closed = sorted.filter((r) => r.status === "closed");
  const out = ["## Open risks", "", table(open)];
  if (closed.length > 0) out.push("", "## Closed risks", "", table(closed));
  return out.join("\n");
}

/** Reads every risk file. Errors name the file. */
export function loadRisks(dir) {
  const folder = join(dir, RISKS_DIR);
  const risks = [];
  const errors = [];
  const files = readdirSync(folder)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();
  for (const file of files) {
    try {
      risks.push({ ...parseRisk(file, readFileSync(join(folder, file), "utf8")), file });
    } catch (err) {
      errors.push(`${RISKS_DIR}/${file}: ${err.message}`);
    }
  }
  return { risks, errors: [...errors, ...duplicateIds(risks)] };
}

/**
 * File names carry the id, so a folder can't hold two; this guards anything that builds the
 * list another way. Case-insensitive, as macOS file names are.
 */
export function duplicateIds(risks) {
  const seen = new Map();
  const errors = [];
  for (const r of risks) {
    const key = r.id.toUpperCase();
    if (seen.has(key)) errors.push(`${r.file} and ${seen.get(key)} share id ${r.id}`);
    seen.set(key, r.file);
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "--status") {
  const source = process.argv[3];
  if (!source) {
    process.stderr.write("risks: --status needs a file or -\n");
    process.exit(2);
  }
  process.stdout.write(`${statusOf(readFileSync(source === "-" ? 0 : source, "utf8"))}\n`);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { risks, errors } = loadRisks(process.argv[2] ?? ".");
  if (errors.length > 0) {
    process.stderr.write(`risks: ${errors.join("\nrisks: ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${renderRegister(risks)}\n`);
}
