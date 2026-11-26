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

/** The project setting `deployKind` (ADR-0114) values; anything else is refused. */
export const DEPLOY_KINDS = ["none", "cloud-run"];

/** Throws unless `kind` is a known deploy kind; returns it. */
export function checkDeployKind(kind) {
  if (!DEPLOY_KINDS.includes(kind)) {
    throw new Error(`deploy kind must be one of ${DEPLOY_KINDS.join(", ")}, got ${String(kind)}`);
  }
  return kind;
}

/**
 * Renders the manifest. `read(from)` returns a source file's text at the pinned commit. An entry
 * with `deployKind` is rendered only for a project of that kind (ADR-0114: a `none` project gets
 * no deploy or release workflow); `deployKind` defaults to `none`.
 * Returns { managed, lines, seed, starter }, each a list of { path, content } (lines: { path, lines }).
 */
export function renderFiles(manifest, read, { sha, ref, deployKind = "none" }) {
  const source = manifest.source;
  checkDeployKind(deployKind);
  const forKind = (entries) => entries.filter((f) => !f.deployKind || f.deployKind === deployKind);
  return {
    managed: forKind(manifest.managed).map((f) => ({
      path: f.path,
      content: f.pin ? pinActions(read(f.from), { source, sha, ref }) : read(f.from),
    })),
    lines: forKind(manifest.lines).map((f) => ({
      path: f.path,
      lines: requiredLines(read(f.from)),
    })),
    seed: forKind(manifest.seed).map((f) => ({ path: f.path, content: read(f.from) })),
    starter: forKind(manifest.starter).map((f) => ({ path: f.path, content: read(f.from) })),
  };
}

/**
 * The seed files to write: those the repo doesn't have yet. Seeds (agent rules, threat model,
 * design file) are the project's own once written, so an existing one is never overwritten.
 */
export function seedsToWrite(seed, exists) {
  return seed.filter((f) => !exists(f.path));
}

/**
 * The `.andy/baseline.json` record written into a managed repo. `deployKind` records which kind's
 * files were rendered, so `check` and a later `files` render the same set.
 */
export function baselineRecord({ source, sha, ref, date, deployKind = "none" }) {
  const record = { source, version: sha, ref, updated: date, deployKind };
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** The deploy kind a record names; `none` for records written before the field. */
export function recordedDeployKind(record) {
  return checkDeployKind(record?.deployKind ?? "none");
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
