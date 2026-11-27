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

// A seed Terraform root's module source as it reads in this repo (template/infra/<kind>/<env>/).
const LOCAL_MODULE = /^(\s*source\s*=\s*)"(?:\.\.\/)+infra\/modules\/([\w-]+)"[ \t]*$/gm;

/**
 * Rewrites local `source = "../../infra/modules/X"` lines to the pinned remote module,
 * `git::https://github.com/<source>.git//infra/modules/X?ref=<sha>` (ADR-0038 Terraform carrier).
 */
export function pinModules(text, { source, sha, ref }) {
  return text.replace(
    LOCAL_MODULE,
    (_, prefix, name) =>
      `${prefix}"git::https://github.com/${source}.git//infra/modules/${name}?ref=${sha}" # ${ref}`,
  );
}

/** Pins local actions and Terraform modules to the baseline commit. */
export function pinSources(text, pin) {
  return pinModules(pinActions(text, pin), pin);
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

/** The project setting `environments` (AI-160, ADR-0114) values; read only for `cloud-run`. */
export const ENVIRONMENTS = ["prod-only", "dev-and-prod"];

/** Throws unless `value` is a known environment policy; returns it. */
export function checkEnvironments(value) {
  if (!ENVIRONMENTS.includes(value)) {
    throw new Error(`environments must be one of ${ENVIRONMENTS.join(", ")}, got ${String(value)}`);
  }
  return value;
}

/**
 * The CLI flags that render a project's deploy files: none for `none`; the kind and, for
 * `cloud-run`, its environment policy. Starts with a space when not empty.
 */
export function deployFlags({ deployKind = "none", environments = "prod-only" }) {
  if (checkDeployKind(deployKind) === "none") return "";
  const env =
    deployKind === "cloud-run" ? ` --environments ${checkEnvironments(environments)}` : "";
  return ` --deploy-kind ${deployKind}${env}`;
}

/**
 * Renders the manifest. `read(from)` returns a source file's text at the pinned commit. An entry
 * with `deployKind` is rendered only for a project of that kind (ADR-0114: a `none` project gets
 * no deploy files), one with `environments` only for a project with that policy (AI-109: the
 * `cloud-run` template root has one environment or two). A new kind adds its own entries here,
 * never code. Defaults: `none`, `prod-only`.
 * Returns { managed, lines, seed, starter }, each a list of { path, content } (lines: { path, lines }).
 */
export function renderFiles(
  manifest,
  read,
  { sha, ref, deployKind = "none", environments = "prod-only" },
) {
  const source = manifest.source;
  checkDeployKind(deployKind);
  checkEnvironments(environments);
  const pick = (entries) =>
    entries.filter(
      (f) =>
        (!f.deployKind || f.deployKind === deployKind) &&
        (!f.environments || f.environments === environments),
    );
  const content = (f) => (f.pin ? pinSources(read(f.from), { source, sha, ref }) : read(f.from));
  return {
    managed: pick(manifest.managed).map((f) => ({ path: f.path, content: content(f) })),
    lines: pick(manifest.lines).map((f) => ({
      path: f.path,
      lines: requiredLines(read(f.from)),
    })),
    seed: pick(manifest.seed).map((f) => ({
      path: f.path,
      content: content(f),
      ...(f.group ? { group: f.group } : {}),
      ...(f.ownAppNote ? { ownAppNote: f.ownAppNote } : {}),
    })),
    starter: pick(manifest.starter).map((f) => ({ path: f.path, content: content(f) })),
  };
}

/**
 * Seed groups with a file already in the repo. A group (e.g. the `infra/` Terraform root) only
 * works whole, so none of it is written next to a project's own files (AI-109).
 */
export function presentGroups(seed, exists) {
  return new Set(seed.filter((f) => f.group && exists(f.path)).map((f) => f.group));
}

/**
 * The seed files to write: those the repo doesn't have yet, and no file of a group that is
 * partly there. Seeds (agent rules, threat model, design file, the deploy root) are the
 * project's own once written, so an existing one is never overwritten.
 */
export function seedsToWrite(seed, exists) {
  const present = presentGroups(seed, exists);
  return seed.filter((f) => !exists(f.path) && !(f.group && present.has(f.group)));
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
  // A group partly there is the project's own (seedsToWrite never adds to it): not drift.
  const present = presentGroups(rendered.seed, (p) => readTarget(p) !== null);
  for (const f of rendered.seed) {
    if (f.group && present.has(f.group)) continue;
    if (readTarget(f.path) === null) drift.push({ path: f.path, issue: "missing (seed file)" });
  }
  return drift;
}
