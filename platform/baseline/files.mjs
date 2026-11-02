// Project baseline files (ADR-0031, ADR-0038): render the manifest at a pinned commit and
// compare a repo's files with it. Pure functions; I/O is passed in.

const LOCAL_ACTION = /^(\s*(?:-\s+)?uses:\s+)\.\/platform\/actions\/([\w-]+)[ \t]*$/gm;

/** Rewrites local `./platform/actions/X` uses to `<source>/platform/actions/X@<sha> # <ref>`. */
export function pinActions(text, { source, sha, ref }) {
  return text.replace(
    LOCAL_ACTION,
    (_, prefix, name) => `${prefix}${source}/platform/actions/${name}@${sha} # ${ref}`,
  );
}

/** Replaces pinned baseline action SHAs (and their comment) with a placeholder; returns the SHAs. */
export function normalizePins(text, source) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pinned = new RegExp(`(${escaped}/platform/actions/[\\w-]+)@([0-9a-f]{40})(?: #.*)?$`, "gm");
  const shas = new Set();
  const normalized = text.replace(pinned, (_, action, sha) => {
    shas.add(sha);
    return `${action}@PINNED`;
  });
  return { text: normalized, shas };
}

/** Lines of a `lines` template: non-empty, trimmed. */
export function requiredLines(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** Appends the required lines that `existing` lacks; returns the new text (unchanged when complete). */
export function mergeLines(existing, required) {
  const have = new Set(requiredLines(existing ?? ""));
  const missing = required.filter((l) => !have.has(l));
  if (missing.length === 0) return existing ?? "";
  const base = existing && !existing.endsWith("\n") ? `${existing}\n` : (existing ?? "");
  const header = base === "" ? "" : "\n";
  return `${base}${header}# Project baseline (andy-intelligence)\n${missing.join("\n")}\n`;
}

/**
 * Renders the manifest. `read(from)` returns a source file's text at the pinned commit.
 * Returns { managed, lines, seed, starter }, each a list of { path, content } (lines: { path, lines }).
 */
export function renderFiles(manifest, read, { sha, ref }) {
  const source = manifest.source;
  return {
    managed: manifest.managed.map((f) => ({
      path: f.path,
      content: f.pin ? pinActions(read(f.from), { source, sha, ref }) : read(f.from),
    })),
    lines: manifest.lines.map((f) => ({ path: f.path, lines: requiredLines(read(f.from)) })),
    seed: manifest.seed.map((f) => ({ path: f.path, content: read(f.from) })),
    starter: manifest.starter.map((f) => ({ path: f.path, content: read(f.from) })),
  };
}

/** The `.andy/baseline.json` record written into a managed repo. */
export function baselineRecord({ source, sha, ref, date }) {
  return `${JSON.stringify({ source, version: sha, ref, updated: date }, null, 2)}\n`;
}

/**
 * Compares a repo's files with the rendered baseline. `readTarget(path)` returns text or null.
 * `version` is the SHA in the repo's `.andy/baseline.json`. Returns a list of { path, issue }.
 */
export function fileDrift(rendered, readTarget, { source, version }) {
  const drift = [];
  for (const f of rendered.managed) {
    const have = readTarget(f.path);
    if (have === null) {
      drift.push({ path: f.path, issue: "missing" });
      continue;
    }
    const want = normalizePins(f.content, source);
    const got = normalizePins(have, source);
    if (want.text !== got.text) drift.push({ path: f.path, issue: "differs from the baseline" });
    const stale = [...got.shas].filter((s) => s !== version);
    if (stale.length > 0) {
      drift.push({
        path: f.path,
        issue: `pins ${stale.map((s) => s.slice(0, 7)).join(", ")}, but .andy/baseline.json says ${version.slice(0, 7)}; re-run \`files\` at the new version`,
      });
    }
  }
  for (const f of rendered.lines) {
    const have = new Set(requiredLines(readTarget(f.path) ?? ""));
    const missing = f.lines.filter((l) => !have.has(l));
    if (missing.length > 0)
      drift.push({ path: f.path, issue: `missing lines: ${missing.join(", ")}` });
  }
  for (const f of rendered.seed) {
    if (readTarget(f.path) === null) drift.push({ path: f.path, issue: "missing (seed file)" });
  }
  return drift;
}
